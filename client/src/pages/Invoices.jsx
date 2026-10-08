import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client.js';
import Navbar from '../components/Navbar.jsx';

const STATUS_COLORS = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  partial: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  disputed: 'bg-purple-50 text-purple-700 border-purple-200',
};

function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(null); // invoice object when open
  const [importStatus, setImportStatus] = useState(null);
  const fileInputRef = useRef(null);

  // Form states
  const [addForm, setAddForm] = useState({
    client_id: '',
    invoice_no: '',
    amount: '',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });
  const [payForm, setPayForm] = useState({
    amount: '',
    method: 'upi',
    reference: '',
  });
  const [formError, setFormError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filter) params.status = filter;
      if (search) params.search = search;
      const res = await api.get('/invoices', { params });
      setInvoices(res.data.data || []);
    } catch (err) {
      console.error('Failed to load invoices', err);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const fetchClients = useCallback(async () => {
    try {
      const res = await api.get('/clients', { params: { limit: 100 } });
      setClients(res.data.data || []);
    } catch (err) {
      console.error('Failed to load clients', err);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleAddInvoice = async (e) => {
    e.preventDefault();
    setFormError(null);
    setActionLoading(true);
    try {
      await api.post('/invoices', {
        ...addForm,
        amount: parseFloat(addForm.amount),
        currency: 'INR',
      });
      setShowAddModal(false);
      setAddForm({
        client_id: '',
        invoice_no: '',
        amount: '',
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      });
      fetchInvoices();
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Failed to create invoice');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    setFormError(null);
    setActionLoading(true);
    try {
      await api.post('/payments', {
        invoice_id: showPayModal.id,
        amount: parseFloat(payForm.amount),
        method: payForm.method,
        reference: payForm.reference || undefined,
      });
      setShowPayModal(null);
      setPayForm({ amount: '', method: 'upi', reference: '' });
      fetchInvoices();
    } catch (err) {
      setFormError(err.response?.data?.error?.message || 'Failed to record payment');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);

    setImportStatus({ loading: true });
    try {
      const res = await api.post('/invoices/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportStatus({
        success: true,
        message: `Imported ${res.data.imported} invoice(s) successfully!`,
        errors: res.data.errors,
      });
      fetchInvoices();
    } catch (err) {
      setImportStatus({
        success: false,
        message: err.response?.data?.error?.message || 'CSV Import failed',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage accounts receivable, track payment status, and import invoices.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              onChange={handleCSVUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition"
            >
              Import CSV
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-indigo-700 transition"
            >
              + Add Invoice
            </button>
          </div>
        </div>

        {/* CSV import alert */}
        {importStatus && (
          <div
            className={`mt-4 rounded-lg p-4 border text-sm flex items-start justify-between ${
              importStatus.success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <div>
              <p className="font-semibold">{importStatus.message}</p>
              {importStatus.errors?.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-xs text-rose-700 space-y-0.5">
                  {importStatus.errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row}: {err.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setImportStatus(null)}
              className="text-xs font-bold underline opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filters and search */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            {['', 'pending', 'overdue', 'partial', 'paid', 'disputed'].map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  filter === status
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {status || 'All'}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search invoice # or client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Invoices Table */}
        <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">Loading invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-slate-500 text-sm font-medium">No invoices found</p>
              <p className="text-slate-400 text-xs mt-1">Try changing filters or add your first invoice.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Client</th>
                    <th className="px-5 py-3 font-semibold text-right">Amount</th>
                    <th className="px-5 py-3 font-semibold text-right">Paid</th>
                    <th className="px-5 py-3 font-semibold">Due Date</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((inv) => {
                    const isSettled = inv.status === 'paid';
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5 font-medium text-slate-900 font-mono text-xs">
                          {inv.invoice_no}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-900">
                          {inv.client_name}
                        </td>
                        <td className="px-5 py-3.5 text-right font-medium text-slate-900">
                          {formatCurrency(inv.amount, inv.currency)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-500">
                          {formatCurrency(inv.paid_amount, inv.currency)}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-600">
                          {inv.due_date?.slice(0, 10)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${
                              STATUS_COLORS[inv.status] || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {!isSettled && (
                            <button
                              onClick={() => {
                                setShowPayModal(inv);
                                setPayForm({
                                  amount: (inv.amount - inv.paid_amount).toString(),
                                  method: 'upi',
                                  reference: '',
                                });
                              }}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
                            >
                              Record Pay
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add Invoice Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Add New Invoice</h3>
            <form onSubmit={handleAddInvoice} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Client</label>
                <select
                  required
                  value={addForm.client_id}
                  onChange={(e) => setAddForm({ ...addForm, client_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Invoice Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. INV-6001"
                  value={addForm.invoice_no}
                  onChange={(e) => setAddForm({ ...addForm, invoice_no: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Amount (INR)</label>
                <input
                  type="number"
                  required
                  min="1"
                  placeholder="e.g. 50000"
                  value={addForm.amount}
                  onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Issue Date</label>
                  <input
                    type="date"
                    required
                    value={addForm.issue_date}
                    onChange={(e) => setAddForm({ ...addForm, issue_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Due Date</label>
                  <input
                    type="date"
                    required
                    value={addForm.due_date}
                    onChange={(e) => setAddForm({ ...addForm, due_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {formError && (
                <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-md">{formError}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Record Payment</h3>
            <p className="text-xs text-slate-500 mt-1">
              Invoice #{showPayModal.invoice_no} ({showPayModal.client_name})
            </p>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Amount (INR)</label>
                <input
                  type="number"
                  required
                  min="1"
                  max={showPayModal.amount - showPayModal.paid_amount}
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-400">
                  Remaining balance: {formatCurrency(showPayModal.amount - showPayModal.paid_amount)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Payment Method</label>
                <select
                  value={payForm.method}
                  onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="upi">UPI</option>
                  <option value="bank">Bank Transfer (NEFT/RTGS)</option>
                  <option value="card">Credit/Debit Card</option>
                  <option value="cash">Cash / Cheque</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Reference / UTR (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. UPI-987654"
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {formError && (
                <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-md">{formError}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPayModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
