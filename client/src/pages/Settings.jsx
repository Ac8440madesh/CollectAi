import { useState, useEffect } from 'react';
import api from '../api/client.js';
import Navbar from '../components/Navbar.jsx';

export default function Settings() {
  const [policy, setPolicy] = useState({
    approval_amount_threshold: 50000,
    max_extension_days: 14,
    max_discount_pct: 10,
    min_partial_pct: 25,
    dry_run: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .get('/policy')
      .then((res) => {
        if (active && res.data) {
          setPolicy({
            approval_amount_threshold: parseFloat(res.data.approval_amount_threshold),
            max_extension_days: parseInt(res.data.max_extension_days, 10),
            max_discount_pct: parseFloat(res.data.max_discount_pct),
            min_partial_pct: parseFloat(res.data.min_partial_pct),
            dry_run: Boolean(res.data.dry_run),
          });
        }
      })
      .catch((err) => console.error('Failed to load policy', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await api.put('/policy', policy);
      setStatus({ success: true, message: 'Policy settings saved successfully!' });
    } catch (err) {
      setStatus({
        success: false,
        message: err.response?.data?.error?.message || 'Failed to save policy settings',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agent Guardrails & Settings</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure the policy boundaries and safety limits under which autonomous agents operate.
          </p>
        </div>

        {status && (
          <div
            className={`mt-6 rounded-xl p-4 text-sm flex items-center justify-between ${
              status.success
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            <span>{status.message}</span>
            <button
              onClick={() => setStatus(null)}
              className="text-xs font-bold underline opacity-75 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-6 space-y-6">
          {/* Card 1: Approval Gate Rules */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Approval Gate Threshold</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Invoices above this amount will pause for your review before follow-up reminders are dispatched.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Threshold Amount (INR ₹)
              </label>
              <div className="relative rounded-lg max-w-xs">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm">
                  ₹
                </span>
                <input
                  type="number"
                  required
                  min="0"
                  step="1000"
                  value={policy.approval_amount_threshold}
                  onChange={(e) =>
                    setPolicy({ ...policy, approval_amount_threshold: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Default is ₹50,000. Invoices ≤ ₹50,000 are processed autonomously; invoices &gt; ₹50,000 route to Approvals.
              </p>
            </div>
          </div>

          {/* Card 2: Autonomous Negotiation Limits */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Autonomous Negotiation Policy</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Limits within which the AI Negotiator agent can autonomously accept payment plans.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Max Extension Days
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max="90"
                  value={policy.max_extension_days}
                  onChange={(e) =>
                    setPolicy({ ...policy, max_extension_days: parseInt(e.target.value, 10) || 1 })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">e.g. 14 days</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Max Settlement Discount (%)
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  max="50"
                  value={policy.max_discount_pct}
                  onChange={(e) =>
                    setPolicy({ ...policy, max_discount_pct: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">e.g. 10% discount</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Min Partial Payment (%)
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  max="100"
                  value={policy.min_partial_pct}
                  onChange={(e) =>
                    setPolicy({ ...policy, min_partial_pct: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">e.g. 25% upfront</span>
              </div>
            </div>
          </div>

          {/* Card 3: Safety & Dry-Run Mode */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Dry-Run Simulation Mode</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                When enabled, follow-ups are safely stored as &quot;sent (dry run)&quot; and never leave the system.
              </p>
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={policy.dry_run}
                onChange={(e) => setPolicy({ ...policy, dry_run: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading || saving}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition shadow-xs disabled:opacity-50"
            >
              {saving ? 'Saving Policy...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
