import { useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';
import Navbar from '../components/Navbar.jsx';

const AGENT_BADGES = {
  monitor: 'bg-blue-50 text-blue-700 border-blue-200',
  analyst: 'bg-purple-50 text-purple-700 border-purple-200',
  communicator: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negotiator: 'bg-amber-50 text-amber-700 border-amber-200',
  reconciler: 'bg-teal-50 text-teal-700 border-teal-200',
  escalation: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function AgentActivity() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [expandedLogs, setExpandedLogs] = useState({});
  const [lastRunResult, setLastRunResult] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: 50 };
      if (agentFilter) params.agent = agentFilter;
      const res = await api.get('/agents/logs', { params });
      setLogs(res.data.data || []);
    } catch (err) {
      console.error('Failed to load agent logs', err);
    } finally {
      setLoading(false);
    }
  }, [agentFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleRunAgents = async () => {
    try {
      setRunning(true);
      setLastRunResult(null);
      const res = await api.post('/agents/run');
      setLastRunResult(res.data);
      await fetchLogs();
    } catch (err) {
      console.error('Agent run failed', err);
      setLastRunResult({ error: err.response?.data?.error?.message || 'Agent cycle failed' });
    } finally {
      setRunning(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {/* Header / Trigger section */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Agent Orchestrator Ready
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Agent Activity & Audit Trail</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              Monitor and analyze overdue receivables autonomously. Every decision is logged with strict reasoning.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchLogs}
              disabled={loading || running}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Refresh Feed
            </button>
            <button
              onClick={handleRunAgents}
              disabled={running}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {running ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Running Agents...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run Agents Now
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live execution progress feedback */}
        {lastRunResult && (
          <div className="mt-6 bg-white rounded-xl border border-indigo-100 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="text-indigo-600">⚡</span> Latest Orchestrator Run Execution
            </h3>
            {lastRunResult.error ? (
              <div className="mt-2 text-xs text-rose-600 bg-rose-50 p-3 rounded-lg">
                {lastRunResult.error}
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {lastRunResult.steps?.map((step, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 capitalize">
                        Step {idx + 1}: {step.agent}
                      </span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">
                        Completed
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{step.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filter bar */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {['', 'monitor', 'analyst'].map((agent) => (
              <button
                key={agent}
                onClick={() => setAgentFilter(agent)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  agentFilter === agent
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {agent ? `${agent} Agent` : 'All Agents'}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-400 font-medium">{logs.length} logged actions</span>
        </div>

        {/* Feed cards */}
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
              Loading audit logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-sm font-medium text-slate-600">No agent actions logged yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Click &quot;Run Agents Now&quot; to trigger the autonomous monitor & analyst cycle.
              </p>
            </div>
          ) : (
            logs.map((log) => {
              const isExpanded = expandedLogs[log.id];
              return (
                <div
                  key={log.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border ${
                          AGENT_BADGES[log.agent] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {log.agent}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {log.input_summary || 'Executed task'}
                      </span>
                    </div>

                    <span className="text-xs text-slate-400">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>

                  {log.reasoning && (
                    <div className="mt-3 bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">Reasoning: </span>
                      {log.reasoning}
                    </div>
                  )}

                  {log.output_json && (
                    <div className="mt-3">
                      <button
                        onClick={() => toggleExpand(log.id)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                      >
                        <span>{isExpanded ? '▼ Hide' : '▶ View'} Structured JSON Payload</span>
                      </button>
                      {isExpanded && (
                        <pre className="mt-2 bg-slate-900 text-slate-100 text-[11px] p-4 rounded-lg overflow-x-auto font-mono">
                          {JSON.stringify(log.output_json, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
