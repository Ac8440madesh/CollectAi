import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get('/approvals')
      .then((res) => {
        if (active) setPendingApprovals(res.data.total || res.data.data?.length || 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const navLinks = [
    { to: '/', label: 'Dashboard' },
    { to: '/invoices', label: 'Invoices' },
    { to: '/agent-activity', label: 'Agent Activity' },
    { to: '/approvals', label: 'Approvals', badge: pendingApprovals },
    { to: '/inbox-simulator', label: 'Inbox Simulator' },
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-30 shadow-xs">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3">
        <div className="flex items-center gap-6 md:gap-8">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-indigo-600 inline-block" />
              CollectAI
            </span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto py-1">
            {navLinks.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap flex items-center gap-1.5 ${
                    active
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {link.label}
                  {Boolean(link.badge) && (
                    <span className="inline-flex items-center justify-center h-4.5 min-w-4.5 px-1.5 text-[10px] font-bold rounded-full bg-rose-500 text-white">
                      {link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-sm font-medium text-slate-900">{user?.name || 'User'}</span>
            <span className="text-xs text-slate-500">{user?.business_name || user?.email}</span>
          </div>

          <button
            onClick={logout}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
