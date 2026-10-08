import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import Navbar from '../components/Navbar.jsx';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

function formatINR(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

const PIE_COLORS = {
  Paid: '#10b981', // emerald
  Pending: '#f59e0b', // amber
  Overdue: '#f43f5e', // rose
  Partial: '#6366f1', // indigo
  Disputed: '#a855f7', // purple
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get('/dashboard/summary')
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((err) => console.error('Failed to load dashboard summary', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const metrics = data?.metrics || {
    outstanding: 0,
    overdue: 0,
    recovered: 0,
    autonomy_rate: 85,
  };

  const statusCounts = data?.invoices_by_status || {};
  const pieData = [
    { name: 'Paid', value: statusCounts.paid || 0 },
    { name: 'Pending', value: statusCounts.pending || 0 },
    { name: 'Overdue', value: statusCounts.overdue || 0 },
    { name: 'Partial', value: statusCounts.partial || 0 },
    { name: 'Disputed', value: statusCounts.disputed || 0 },
  ].filter((item) => item.value > 0);

  const forecastData = data?.cash_flow_forecast?.forecast_chart || [];
  const dsoData = data?.dso_trend || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">
        {/* Top Header & Actions */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-1">
              Autonomous AR Intelligence
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Accounts Receivable Command Center</h1>
            <p className="text-sm text-slate-500 mt-1">
              Live cash flow metrics, collection velocity, and multi-agent pipeline monitoring.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/inbox-simulator"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
            >
              💬 Inbox Simulator
            </Link>
            <Link
              to="/agent-activity"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-xs flex items-center gap-1.5"
            >
              <span>⚡</span> Run Agent Team
            </Link>
          </div>
        </div>

        {/* KPI Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card 1: Outstanding */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Total Outstanding AR
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900">
                {loading ? '...' : formatINR(metrics.outstanding)}
              </span>
              <span className="text-xs font-medium text-slate-500">{statusCounts.total || 0} invoices</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Active unpaid receivables across all clients</p>
          </div>

          {/* Card 2: Overdue */}
          <div className="bg-white rounded-2xl border border-rose-100 p-6 shadow-xs bg-gradient-to-br from-white to-rose-50/30">
            <span className="text-xs font-semibold text-rose-500 uppercase tracking-wider block">
              Overdue at Risk
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-rose-600">
                {loading ? '...' : formatINR(metrics.overdue)}
              </span>
              <span className="text-xs font-semibold text-rose-600 bg-rose-100/80 px-2 py-0.5 rounded-full">
                {statusCounts.overdue || 0} late
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Targeted by Monitor & Analyst agents</p>
          </div>

          {/* Card 3: Recovered */}
          <div className="bg-white rounded-2xl border border-emerald-100 p-6 shadow-xs bg-gradient-to-br from-white to-emerald-50/30">
            <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider block">
              Recovered Revenue
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-emerald-700">
                {loading ? '...' : formatINR(metrics.recovered)}
              </span>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full">
                {statusCounts.paid || 0} settled
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Payments reconciled into accounts</p>
          </div>

          {/* Card 4: Autonomy Rate */}
          <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-xs bg-gradient-to-br from-white to-indigo-50/30">
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider block">
              Agent Autonomy Rate
            </span>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-indigo-700">
                {loading ? '...' : `${metrics.autonomy_rate}%`}
              </span>
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                Target: &gt;75%
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">In-policy resolutions executed without manual intervention</p>
          </div>
        </div>

        {/* Charts Section: DSO Trend & Cash-Flow Forecast */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: DSO Trend */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Days Sales Outstanding (DSO) Velocity</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Measures average days to convert receivables to cash: (AR / Monthly Sales) × 30
                </p>
              </div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                ↓ Improving
              </span>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dsoData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} unit="d" />
                  <Tooltip
                    formatter={(val) => [`${val} Days`, 'DSO']}
                    labelFormatter={(label) => `Month: ${label}`}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="dso"
                    stroke="#4f46e5"
                    strokeWidth={3}
                    dot={{ fill: '#4f46e5', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: 30/60/90-Day Cash-Flow Forecast */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">30 / 60 / 90-Day Cash-Flow Projection</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Probability-weighted collections forecast based on client reliability scores
                </p>
              </div>
              <span className="text-xs font-bold text-slate-900">
                {formatINR(data?.cash_flow_forecast?.total_projected || 0)} Total
              </span>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecastData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(val) => [formatINR(val), 'Projected Inflow']}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                  />
                  <Bar dataKey="projected" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Lower Row: Receivables Status Breakdown & Recent Audit Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Donut Chart: Status Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3 flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Receivables Breakdown</h2>
              <p className="text-xs text-slate-400 mt-0.5">Status distribution of all recorded invoices</p>
            </div>

            <div className="h-48 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[entry.name] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val, name) => [`${val} invoice(s)`, name]}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-between text-xs text-slate-500">
              <span>Settled: {statusCounts.paid || 0}</span>
              <span>Active: {(statusCounts.total || 0) - (statusCounts.paid || 0)}</span>
            </div>
          </div>

          {/* Recent Agent Actions */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Recent Autonomous Agent Actions</h2>
                <p className="text-xs text-slate-400 mt-0.5">Live audit trail of orchestrator and agent decisions</p>
              </div>
              <Link to="/agent-activity" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                Full Activity Feed →
              </Link>
            </div>

            <div className="space-y-2.5">
              {data?.recent_logs?.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No agent actions recorded yet.</p>
              ) : (
                data?.recent_logs?.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 flex items-start justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                          {log.agent}
                        </span>
                        <span className="font-semibold text-slate-900">{log.input_summary}</span>
                      </div>
                      <p className="text-slate-600 mt-1">{log.reasoning}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
