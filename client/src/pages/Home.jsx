import { useEffect, useState } from 'react';
import api from '../api/client.js';

/**
 * Phase 0 landing page.
 *
 * Pings the backend's /api/health so we can SEE the client, Vite proxy, CORS,
 * and Axios base URL are all wired correctly end to end. Real pages (Login,
 * Dashboard, …) arrive in later phases.
 */
export default function Home() {
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">CollectAI</h1>
        <p className="mt-1 text-sm text-slate-500">
          Autonomous accounts-receivable agent team
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Backend API status
          </div>

          {health.state === 'loading' && <p className="mt-1 text-slate-600">Checking…</p>}

          {health.state === 'ok' && (
            <p className="mt-1 flex items-center gap-2 font-medium text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Connected — {health.data.status}
            </p>
          )}

          {health.state === 'error' && (
            <p className="mt-1 flex items-center gap-2 font-medium text-red-600">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
              Not reachable — {health.message}
            </p>
          )}
        </div>

        <p className="mt-6 text-xs text-slate-400">Phase 0 scaffold · more coming soon</p>
      </div>
    </div>
  );
}
