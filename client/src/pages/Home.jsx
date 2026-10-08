import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Protected landing page (placeholder until the real Dashboard arrives in a
 * later phase). Confirms who is logged in, that the API is reachable, and
 * offers a logout — enough to prove the auth round-trip end to end.
 */
export default function Home() {
  const { user, logout } = useAuth();
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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">CollectAI</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              Phase 1
            </span>
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">
          Welcome{user?.name ? `, ${user.name}` : ''} 👋
        </h1>
        <p className="mt-1 text-slate-500">
          You are signed in{user?.business_name ? ` for ${user.business_name}` : ''}. The dashboard,
          invoices, and agent activity arrive in the next phases.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Signed-in user
            </div>
            <dl className="mt-2 space-y-1 text-sm text-slate-700">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Email</dt>
                <dd className="truncate">{user?.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Business</dt>
                <dd className="truncate">{user?.business_name ?? '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Backend API
            </div>
            {health.state === 'loading' && <p className="mt-2 text-sm text-slate-600">Checking…</p>}
            {health.state === 'ok' && (
              <p className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                Connected — {health.data.status}
              </p>
            )}
            {health.state === 'error' && (
              <p className="mt-2 flex items-center gap-2 text-sm font-medium text-red-600">
                <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
                Not reachable — {health.message}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
