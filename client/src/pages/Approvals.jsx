import { useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';
import Navbar from '../components/Navbar.jsx';

function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function Approvals() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [editModal, setEditModal] = useState(null); // approval item when open
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/approvals');
      setApprovals(res.data.data || []);
    } catch (err) {
      console.error('Failed to load approvals', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleDecide = async (id, decision, payload = {}) => {
    try {
      setActionLoading(true);
      setError(null);
      await api.post(`/approvals/${id}/decide`, {
        decision,
        ...payload,
      });
      setFeedback({
        type: decision === 'reject' ? 'info' : 'success',
        message:
          decision === 'approve'
            ? 'Action approved and follow-up sent!'
            : decision === 'edit_and_approve'
              ? 'Edited draft approved and sent!'
              : 'Action rejected. Communication marked as draft.',
      });
      setEditModal(null);
      fetchApprovals();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Decision failed');
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (item) => {
    setEditModal(item);
    setEditSubject(item.draft_subject || `Payment reminder for Invoice ${item.invoice_no}`);
    setEditBody(item.draft_body || '');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                Human-in-the-loop Guardrail
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Approvals Queue</h1>
            <p className="text-sm text-slate-500 mt-1">
              Review and approve agent recommendations for high-value, disputed, or high-risk invoices.
            </p>
          </div>

          <button
            onClick={fetchApprovals}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition self-start sm:self-auto"
          >
            Refresh Queue
          </button>
        </div>

        {/* Feedback alert */}
        {feedback && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 flex items-center justify-between">
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-xs font-bold underline opacity-75 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* List of pending approvals */}
        <div className="mt-6 space-y-5">
          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-sm text-slate-400 shadow-xs">
              Loading approval queue...
            </div>
          ) : approvals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-xs">
              <div className="text-3xl mb-2">🎉</div>
              <p className="text-base font-bold text-slate-900">All clear! No pending approvals</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                All autonomous agent actions are within your policy limits. When high-value or disputed invoices arise, they will appear here.
              </p>
            </div>
          ) : (
            approvals.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-slate-300 transition space-y-4"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold bg-slate-100 text-slate-800 px-2.5 py-1 rounded-md">
                      {item.invoice_no}
                    </span>
                    <span className="font-semibold text-slate-900 text-base">{item.client_name}</span>
                    <span className="text-xs text-slate-400">({item.client_email || 'No email'})</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-900">
                      {formatCurrency(item.invoice_amount, item.currency)}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border ${
                        item.invoice_status === 'disputed'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {item.invoice_status}
                    </span>
                  </div>
                </div>

                {/* Reason & Recommendation */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900">
                    <span className="font-bold text-amber-950 block mb-1">⚠️ Reason for Escalation</span>
                    {item.reason}
                  </div>

                  <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3.5 text-xs text-indigo-900">
                    <span className="font-bold text-indigo-950 block mb-1">💡 AI Agent Recommendation</span>
                    {item.recommendation}
                  </div>
                </div>

                {/* Draft preview */}
                {item.draft_subject && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                        Draft Subject:
                      </span>
                      <span className="font-semibold text-slate-900">{item.draft_subject}</span>
                    </div>
                    <div>
                      <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">
                        Draft Message:
                      </span>
                      <p className="whitespace-pre-line text-slate-700 font-sans leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                        {item.draft_body}
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => handleDecide(item.id, 'reject')}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-rose-600 border border-rose-200 bg-rose-50/50 hover:bg-rose-50 hover:border-rose-300 transition disabled:opacity-50"
                  >
                    Reject Notice
                  </button>
                  <button
                    onClick={() => openEditModal(item)}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    Edit & Approve
                  </button>
                  <button
                    onClick={() => handleDecide(item.id, 'approve')}
                    disabled={actionLoading}
                    className="px-5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-xs disabled:opacity-50"
                  >
                    Approve & Send
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Edit & Approve Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Edit Follow-Up Notice</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Invoice #{editModal.invoice_no} ({editModal.client_name})
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleDecide(editModal.id, 'edit_and_approve', {
                  edited_subject: editSubject,
                  edited_body: editBody,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  required
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Body</label>
                <textarea
                  required
                  rows={8}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-sans leading-relaxed outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-lg">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save & Approve'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
