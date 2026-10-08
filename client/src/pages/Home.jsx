import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Navbar from '../components/Navbar.jsx';

export default function Home() {
  const { user } = useAuth();
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    let active = true;
    api
      .get('/health')
      .then((res) => active && setHealth({ state: 'ok', data: res.data }))
      .catch((err) => active && setHealth({ state: 'error', message: err.message }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-xs">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-4">
            Phase 2: Core CRUD & Agents
          </div>
          <h1 className="text-3xl font-bold text-slate-900">
            Welcome back{user?.name ? `, ${user.name}` : ''} 👋
          </h1>
          <p className="mt-2 text-slate-600 max-w-2xl leading-relaxed">
            CollectAI monitors receivables, prioritizes overdue collections, and coordinates multi-agent follow-up workflows.
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            <Link
              to="/invoices"
              className="group p-6 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="text-2xl mb-2">📑</div>
                <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition">
                  Invoices & Payments
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  View invoice statuses, record partial or full payments, and import new invoices via CSV.
                </p>
              </div>
              <span className="text-xs font-semibold text-indigo-600 mt-4 flex items-center gap-1">
                Open Invoices →
              </span>
            </Link>

            <Link
              to="/agent-activity"
              className="group p-6 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300 hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="text-2xl mb-2">🤖</div>
                <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition">
                  Agent Activity & Audit Feed
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Trigger the Monitor & Analyst agent pipeline on demand and view the structured decision logs.
                </p>
              </div>
              <span className="text-xs font-semibold text-indigo-600 mt-4 flex items-center gap-1">
                Run Agents Now →
              </span>
            </Link>
          </div>
        </div>

        {/* Status card */}
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${
                health.state === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <div>
              <p className="text-xs font-semibold text-slate-900">Backend API Status</p>
              <p className="text-xs text-slate-500">
                {health.state === 'ok' ? 'Connected (http://localhost:4000)' : 'Connecting to API...'}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400">LLM_MODE: mock</span>
        </div>
      </main>
    </div>
  );
}
