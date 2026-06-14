'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Terminal, Settings, RefreshCw, ShieldAlert, Activity,
  Clock, Cpu, CheckCircle2, XCircle, ChevronRight, BarChart2,
  List, Zap, AlertCircle, Info
} from 'lucide-react';
import { formatLastRunTime } from '@/lib/utils';

type ScraperStatus = 'idle' | 'running' | 'rate-limited' | 'error';

interface PageStat {
  page: number;
  offset: number;
  status: 'success' | 'failed';
  jobs: number;
  duration_ms: number;
  error?: string | null;
}

interface ScraperRun {
  id: number;
  start_time: string;
  end_time?: string | null;
  status: string;
  pages_success: number;
  pages_failed: number;
  jobs_fetched: number;
  jobs_inserted: number;
  duration_seconds?: number | null;
  details?: PageStat[] | null;
  logs?: string | null;
}

const STATUS_MAP: Record<ScraperStatus, { color: string; bg: string; border: string; dot: string; label: string; pulse: boolean }> = {
  idle:           { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400',  label: 'Idle — Ready to scrape',            pulse: false },
  running:        { color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    dot: 'bg-blue-400',     label: 'Running — Scraping in progress...', pulse: true  },
  'rate-limited': { color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   dot: 'bg-amber-400',    label: 'Rate Limited — Cooling down',       pulse: false },
  error:          { color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    dot: 'bg-rose-400',     label: 'Error — Check console logs',        pulse: false },
};

const RUN_STATUS_BADGE: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  error:   'bg-rose-500/15 text-rose-300 border-rose-500/25',
};

const INPUT_CLS = 'w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition';
const LABEL_CLS = 'block text-xs font-bold text-indigo-200/60 mb-2 uppercase tracking-wide';

// pg driver returns numeric columns as strings — always coerce to number
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function fmtDuration(secs: number | string | null | undefined): string {
  if (secs == null || secs === '') return '—';
  const n = toNum(secs);
  if (n < 60) return `${n.toFixed(1)}s`;
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SuccessRing({ success, total }: { success: number | unknown; total: number | unknown }) {
  const pct = toNum(total) > 0 ? Math.round((toNum(success) / toNum(total)) * 100) : 0;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none"
          stroke={pct === 100 ? '#34d399' : pct >= 80 ? '#818cf8' : '#f87171'}
          strokeWidth="6"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xs font-bold ${pct === 100 ? 'text-emerald-400' : pct >= 80 ? 'text-indigo-300' : 'text-rose-400'}`}>{pct}%</span>
      </div>
    </div>
  );
}

export default function ScraperPage() {
  const [status, setStatus]         = useState<ScraperStatus>('idle');
  const [logs, setLogs]             = useState<string[]>([]);
  const [lastRun, setLastRun]       = useState<string | null>(null);
  const [scheduled, setScheduled]   = useState(false);
  const [triggering, setTriggering] = useState(false);

  const [interval, setIntervalVal]  = useState(120);
  const [maxPages, setMaxPages]     = useState(100);
  const [pageSize, setPageSize]     = useState(50);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<'ok' | 'err' | null>(null);

  const [runs, setRuns]             = useState<ScraperRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ScraperRun | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [activeTab, setActiveTab]   = useState<'live' | 'history'>('history');

  // Pagination & global counters states
  const [page, setPage]             = useState(1);
  const pageSizeLimit               = 10;
  const [totalRuns, setTotalRuns]   = useState(0);
  const [globalStats, setGlobalStats] = useState({ total: 0, success: 0, failed: 0 });
  const [autoScroll, setAutoScroll] = useState(true);

  // Live streaming progress state
  const [liveProgress, setLiveProgress] = useState({
    pages_fetched: 0,
    pages_failed: 0,
    jobs_found: 0,
    jobs_inserted: 0,
    current_page: 0,
    last_line: '',
    elapsed_ms: 0,
    activeRunId: null as number | null,
  });
  const sseRef = useRef<EventSource | null>(null);

  const consoleRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const offset = (page - 1) * pageSizeLimit;
      const res  = await fetch(`/api/scraper?limit=${pageSizeLimit}&offset=${offset}`);
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status.status);
        setLastRun(data.status.lastRunTime);
        setScheduled(data.status.isScheduledRunning ?? false);
        if (!configLoaded && data.status.config) {
          setIntervalVal(data.status.config.scrapeInterval);
          setMaxPages(data.status.config.maxPages);
          setPageSize(data.status.config.pageSize);
          setConfigLoaded(true);
        }
      }
      setLogs(data.logs ?? []);
      setRuns(data.runs ?? []);
      if (data.pagination) {
        setTotalRuns(data.pagination.total);
      }
      if (data.global_stats) {
        setGlobalStats(data.global_stats);
      }
    } catch { /* silent */ }
  }, [configLoaded, page]);

  useEffect(() => {
    if (autoScroll && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs, autoScroll]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, status === 'running' ? 2000 : 8000);
    return () => clearInterval(id);
  }, [status, fetchStatus]);

  // Subscribe to SSE stream whenever status turns running
  useEffect(() => {
    if (status === 'running') {
      if (sseRef.current) sseRef.current.close();
      const es = new EventSource('/api/scraper/stream');
      sseRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setLiveProgress(prev => ({ ...prev, ...data }));
        } catch { /* ignore */ }
      };
      es.onerror = () => { es.close(); sseRef.current = null; };
    } else {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    }
    return () => { if (sseRef.current) { sseRef.current.close(); sseRef.current = null; } };
  }, [status]);

  // Elapsed-time ticker — counts up every second while running
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (status !== 'running') { setElapsedSec(0); return; }
    const id = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const handleTrigger = async () => {
    if (status === 'running' || triggering) return;
    setTriggering(true);
    try {
      const res  = await fetch('/api/scraper', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStatus('running');
        setActiveTab('live');
      }
    } finally { setTriggering(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveMsg(null);
    try {
      const res  = await fetch('/api/scraper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrapeInterval: interval, maxPages, pageSize }),
      });
      const data = await res.json();
      setSaveMsg(data.success ? 'ok' : 'err');
      if (data.success) setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg('err');
    } finally { setSaving(false); }
  };

  const loadRunDetail = async (run: ScraperRun) => {
    if (selectedRun?.id === run.id && selectedRun.logs != null) return;
    setLoadingRun(true);
    try {
      const res = await fetch(`/api/scraper?run_id=${run.id}`);
      const data = await res.json();
      if (data.run) setSelectedRun(data.run);
    } finally {
      setLoadingRun(false);
    }
  };

  const s = STATUS_MAP[status];

  const logColor = (line: string) => {
    if (line.includes('[stderr]') || /error/i.test(line))   return 'text-rose-400/90';
    if (line.includes('WARNING') || /rate.limit/i.test(line)) return 'text-amber-400/80';
    if (/inserted|successfully|success/i.test(line))        return 'text-emerald-400/80';
    if (/scheduler|config/i.test(line))                     return 'text-sky-400/70';
    return '';
  };

  const logLineColor = (line: string) => {
    if (/error|failed/i.test(line)) return 'text-rose-400/90';
    if (/warning|rate.limit/i.test(line)) return 'text-amber-400/80';
    if (/inserted|success/i.test(line)) return 'text-emerald-400/80';
    if (/scheduler|config/i.test(line)) return 'text-sky-400/70';
    return 'text-indigo-200/70';
  };

  // Metrics from selected run — coerce all numeric fields from DB (pg returns numerics as strings)
  const details: PageStat[] = Array.isArray(selectedRun?.details) ? selectedRun!.details : [];
  const totalPages = details.length;
  const successPages = details.filter(p => p.status === 'success').length;
  const failedPages = details.filter(p => p.status === 'failed').length;
  const avgMs = totalPages > 0 ? Math.round(details.reduce((a, p) => a + toNum(p.duration_ms), 0) / totalPages) : 0;
  const maxMs = totalPages > 0 ? Math.max(...details.map(p => toNum(p.duration_ms))) : 0;

  return (
    <div className="relative z-10 p-6 flex flex-col gap-5 min-h-full">
      <div className="glow-bg-radial top-[-80px] left-[20%]" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-indigo-100 to-indigo-400 bg-clip-text text-transparent">
            Scraper Engine
          </h2>
          <p className="text-sm text-indigo-200/50 mt-0.5">Monitor, configure, and inspect historical runs of the Upwork job scraper.</p>
        </div>
      </div>

      {/* Top row: 5 stat cards full width */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

        {/* Card 1: Engine Status */}
        <div className={`glass-panel p-5 border ${s.border} ${s.bg} flex flex-col gap-3`}>
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${s.color}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/50">Engine</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot} ${s.pulse ? 'animate-pulse' : ''}`} />
            <span className={`text-base font-bold ${s.color}`}>
              {status === 'idle' ? 'Idle' : status === 'running' ? 'Running' : status === 'rate-limited' ? 'Rate Limited' : 'Error'}
            </span>
          </div>
        </div>

        {/* Card 2: Last Run */}
        <div className="glass-panel p-5 flex flex-col gap-3" title={lastRun ? new Date(lastRun).toLocaleString() : undefined}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/50">Last Run</span>
          </div>
          <p className="text-base font-bold text-indigo-100 truncate">{formatLastRunTime(lastRun)}</p>
        </div>

        {/* Card 3: Total Runs */}
        <div className="glass-panel p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-indigo-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/50">Total Runs</span>
          </div>
          <p className="text-2xl font-extrabold text-indigo-100">{toNum(globalStats.total)}</p>
        </div>

        {/* Card 4: Successful */}
        <div className="glass-panel p-5 flex flex-col gap-3 border border-emerald-500/10 bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/50">Successful</span>
          </div>
          <p className="text-2xl font-extrabold text-emerald-400">
            {toNum(globalStats.success)}
          </p>
        </div>

        {/* Card 5: Failed */}
        <div className={`glass-panel p-5 flex flex-col gap-3 border ${toNum(globalStats.failed) > 0 ? 'border-rose-500/20 bg-rose-500/5' : 'border-indigo-900/30'}`}>
          <div className="flex items-center gap-2">
            <XCircle className={`w-4 h-4 ${toNum(globalStats.failed) > 0 ? 'text-rose-400' : 'text-indigo-400/30'}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/50">Failed</span>
          </div>
          <p className={`text-2xl font-extrabold ${toNum(globalStats.failed) > 0 ? 'text-rose-400' : 'text-indigo-400/30'}`}>
            {toNum(globalStats.failed)}
          </p>
        </div>

      </div>

      {/* Active Run Live Dashboard */}
      {status === 'running' && (
        <div className="relative overflow-hidden rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-950/60 via-indigo-950/40 to-slate-950/60 p-5 flex flex-col gap-4 shadow-lg shadow-blue-950/30">
          {/* Animated grid overlay */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 24px,#818cf8 24px,#818cf8 25px),repeating-linear-gradient(90deg,transparent,transparent 24px,#818cf8 24px,#818cf8 25px)',
          }} />

          {/* Header row */}
          <div className="flex items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-3">
              {/* Animated sonar pulse */}
              <div className="relative w-8 h-8 shrink-0">
                <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
                <span className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping" style={{ animationDelay: '0.4s' }} />
                <div className="relative w-8 h-8 rounded-full bg-blue-600/30 border border-blue-400/40 flex items-center justify-center">
                  <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" style={{ animationDuration: '1.2s' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-extrabold text-blue-200 tracking-tight">
                    Active Scraping Run
                    {liveProgress.activeRunId && (
                      <span className="ml-1 text-blue-400/70 font-mono text-xs">#{liveProgress.activeRunId}</span>
                    )}
                  </p>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wider animate-pulse">
                    LIVE
                  </span>
                </div>
                <p className="text-[11px] text-blue-300/50 mt-0.5 font-mono truncate max-w-xs">
                  {liveProgress.last_line || 'Initializing scraper...'}
                </p>
              </div>
            </div>

            {/* Elapsed timer */}
            <div className="shrink-0 text-right">
              <p className="text-[10px] text-blue-300/40 uppercase font-bold tracking-wider">Elapsed</p>
              <p className="text-xl font-extrabold font-mono text-blue-200 tabular-nums">
                {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
              </p>
            </div>
          </div>

          {/* Live metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 relative z-10">
            {/* Pages Fetched */}
            <div className="bg-blue-900/20 border border-blue-500/15 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-300/50">Pages Fetched</span>
              </div>
              <p className="text-2xl font-extrabold text-blue-100 tabular-nums leading-none">
                {liveProgress.pages_fetched.toLocaleString()}
              </p>
              {liveProgress.pages_failed > 0 && (
                <p className="text-[9px] text-rose-400/70">{liveProgress.pages_failed} failed</p>
              )}
            </div>

            {/* Jobs Found */}
            <div className="bg-violet-900/20 border border-violet-500/15 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-violet-300/50">Jobs Found</span>
              </div>
              <p className="text-2xl font-extrabold text-violet-100 tabular-nums leading-none">
                {liveProgress.jobs_found.toLocaleString()}
              </p>
            </div>

            {/* Jobs Inserted */}
            <div className="bg-emerald-900/20 border border-emerald-500/15 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300/50">Inserted</span>
              </div>
              <p className="text-2xl font-extrabold text-emerald-100 tabular-nums leading-none">
                {liveProgress.jobs_inserted.toLocaleString()}
              </p>
            </div>

            {/* Duplicate Rate */}
            <div className="bg-amber-900/20 border border-amber-500/15 rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300/50">New Rate</span>
              </div>
              <p className="text-2xl font-extrabold text-amber-100 tabular-nums leading-none">
                {liveProgress.jobs_found > 0
                  ? `${Math.round((liveProgress.jobs_inserted / liveProgress.jobs_found) * 100)}%`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Animated progress bar */}
          <div className="relative z-10">
            <div className="flex justify-between text-[10px] text-blue-300/40 mb-1.5 font-mono">
              <span>Page {liveProgress.pages_fetched} of {maxPages}</span>
              <span className="animate-pulse">streaming live data •••</span>
            </div>
            <div className="h-1.5 bg-blue-950/60 rounded-full overflow-hidden border border-blue-900/30">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${maxPages > 0 ? Math.min(100, (liveProgress.pages_fetched / maxPages) * 100) : 0}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #818cf8, #3b82f6)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.8s linear infinite',
                }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Main content: Config + Console/History */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 flex-1">

        {/* Left Sidebar: Actions + Config */}
        <div className="xl:col-span-3 flex flex-col gap-4">

          {/* Actions Card */}
          <div className="glass-panel p-5 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-indigo-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400" /> Actions
            </h3>

            {/* Scrape Now Button */}
            <button
              onClick={handleTrigger}
              disabled={status === 'running' || triggering}
              className={`flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl border text-sm font-bold transition active:scale-[0.98] ${
                status === 'running'
                  ? 'bg-blue-600/10 border-blue-500/20 text-blue-300 cursor-not-allowed opacity-70'
                  : 'bg-emerald-600/15 border-emerald-500/25 hover:bg-emerald-600/30 text-emerald-300 cursor-pointer'
              }`}
            >
              {status === 'running'
                ? <><RefreshCw className="w-4 h-4 animate-spin text-blue-400" /> Scraping in progress...</>
                : <><Play className="w-4 h-4 text-emerald-400 fill-emerald-400/20" /> Scrape Now</>}
            </button>

            {/* Scheduler Status Badge */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-300/40 font-semibold uppercase tracking-wide text-[10px]">Scheduler</span>
              <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                scheduled
                  ? 'bg-sky-500/10 border-sky-500/20 text-sky-300'
                  : 'bg-indigo-950/40 border-indigo-900/30 text-indigo-400/40'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${scheduled ? 'bg-sky-400 animate-pulse' : 'bg-indigo-600/30'}`} />
                {scheduled ? `Active — every ${interval}s` : 'Disabled'}
              </span>
            </div>

            {/* Global Success Rate */}
            {toNum(globalStats.total) > 0 && (
              <div>
                <div className="flex justify-between text-[10px] text-indigo-300/50 font-semibold mb-1.5">
                  <span>Success Rate</span>
                  <span className="text-emerald-400 font-bold">
                    {Math.round((toNum(globalStats.success) / toNum(globalStats.total)) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-indigo-950/60 rounded-full overflow-hidden border border-indigo-900/30">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                    style={{ width: `${Math.round((toNum(globalStats.success) / toNum(globalStats.total)) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-indigo-400/30 mt-1">
                  <span>{toNum(globalStats.success)} success</span>
                  <span>{toNum(globalStats.failed)} failed</span>
                </div>
              </div>
            )}
          </div>

          {/* Config Panel */}
          <div className="glass-panel p-5 flex flex-col">
            <h3 className="text-sm font-bold text-indigo-200 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" /> Configuration
            </h3>
            <form onSubmit={handleSave} className="flex flex-col gap-4 flex-1">
              <div>
                <label className={LABEL_CLS}>Scrape Interval</label>
                <div className="relative">
                  <input type="number" min="30" value={interval} onChange={e => setIntervalVal(parseInt(e.target.value) || 30)}
                    className={`${INPUT_CLS} pr-12`} required />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400/40 font-semibold">sec</span>
                </div>
                <p className="text-[11px] text-indigo-400/40 mt-1">Min 30s.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>Max Pages</label>
                  <input type="number" min="1" max="200" value={maxPages} onChange={e => setMaxPages(parseInt(e.target.value) || 1)}
                    className={INPUT_CLS} required />
                </div>
                <div>
                  <label className={LABEL_CLS}>Page Size</label>
                  <input type="number" min="10" max="50" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value) || 10)}
                    className={INPUT_CLS} required />
                </div>
              </div>
              <div className="py-2 border-y border-indigo-950/40 text-xs text-indigo-400/40 space-y-0.5">
                <div>Max jobs/cycle: <span className="text-indigo-300/60 font-semibold">{(maxPages * pageSize).toLocaleString()}</span></div>
                <div>API cap: <span className="text-indigo-300/60 font-semibold">~5,000</span></div>
              </div>
              <button type="submit" disabled={saving}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-indigo-600/15 border border-indigo-500/25 hover:bg-indigo-600/25 text-indigo-300 text-sm font-bold transition disabled:opacity-50 cursor-pointer">
                {saving
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
                  : saveMsg === 'ok'  ? <span className="text-emerald-400">✓ Saved</span>
                  : saveMsg === 'err' ? <span className="text-rose-400">✗ Failed — retry</span>
                  : 'Save Configuration'}
              </button>
              <div className="mt-auto p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400/80 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/60 leading-relaxed">
                  <strong className="text-amber-400/80 block mb-0.5">Rate Limit Warning</strong>
                  Upwork API caps at ~5,000 jobs. Pages above 100 may trigger HTTP 429.
                </p>
              </div>
            </form>
          </div>
        </div>

        {/* Right panel: Tabs for Live Console / History */}
        <div className="xl:col-span-9 flex flex-col gap-4">

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-indigo-950/40 border border-indigo-900/40 w-fit">
            {[
              { key: 'live',    label: 'Live Console', icon: Terminal },
              { key: 'history', label: 'Run History',  icon: List },
            ].map(({ key, label, icon: Icon }) => (
              <button key={key}
                onClick={() => setActiveTab(key as 'live' | 'history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                  activeTab === key
                    ? 'bg-indigo-600/30 text-indigo-100 shadow'
                    : 'text-indigo-400/60 hover:text-indigo-300'
                }`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
                {key === 'live' && status === 'running' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
              </button>
            ))}
          </div>

          {/* Live Console */}
          {activeTab === 'live' && (
            <div className="glass-panel overflow-hidden flex flex-col" style={{ minHeight: 420 }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-indigo-950/40 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500/70" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/70" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
                  </div>
                  <Terminal className="w-4 h-4 text-indigo-400 ml-2" />
                  <span className="text-sm font-bold text-indigo-200">Scraper Console</span>
                  {status === 'running' && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-indigo-400/60 font-semibold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded border-indigo-900/60 bg-indigo-950/50 text-indigo-600 focus:ring-indigo-500/30"
                    />
                    Auto-scroll
                  </label>
                  <span className="text-[10px] text-indigo-300/30 font-mono">{logs.length} lines</span>
                </div>
              </div>
              <div ref={consoleRef} className="flex-1 p-4 font-mono text-[11px] overflow-y-auto space-y-0.5"
                style={{ background: '#03030e' }}>
                {logs.length === 0 ? (
                  <div className="text-indigo-400/20 text-center py-20 text-xs">
                    No output yet.<br /><span className="text-indigo-400/10">Click &ldquo;Scrape Now&rdquo; to begin.</span>
                  </div>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={`leading-relaxed break-all ${logColor(line)}`}>{line}</div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Run History */}
          {activeTab === 'history' && (
            <div className="flex flex-col gap-4" style={{ minHeight: 420 }}>
              {runs.length === 0 ? (
                <div className="glass-panel p-12 text-center text-indigo-400/30 text-sm">
                  <Info className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  No runs recorded yet. Trigger a scrape to begin.
                </div>
              ) : (
                <>
                  {/* Runs table */}
                  <div className="glass-panel overflow-hidden">
                    <div className="px-5 py-3 border-b border-indigo-950/40 flex items-center gap-2">
                      <List className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm font-bold text-indigo-200">Recent Runs</span>
                      <span className="ml-auto text-[10px] text-indigo-300/30">
                        Showing {totalRuns > 0 ? (page - 1) * pageSizeLimit + 1 : 0}–{Math.min(page * pageSizeLimit, totalRuns)} of {totalRuns}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-indigo-950/40">
                            {['ID', 'Started', 'Duration', 'Status', 'Pages ✓/✗', 'Jobs Fetched', 'Inserted', ''].map(h => (
                              <th key={h} className="px-4 py-3 text-left font-bold text-indigo-300/40 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {runs.map(run => (
                            <tr key={run.id}
                              className={`border-b border-indigo-950/20 hover:bg-indigo-500/5 transition cursor-pointer ${
                                selectedRun?.id === run.id ? 'bg-indigo-500/10' : ''
                              }`}
                              onClick={() => loadRunDetail(run)}>
                              <td className="px-4 py-3 font-mono text-indigo-400/60">#{run.id}</td>
                              <td className="px-4 py-3 text-indigo-200/70 whitespace-nowrap">{fmtTime(run.start_time)}</td>
                              <td className="px-4 py-3 text-indigo-300 font-mono">{fmtDuration(run.duration_seconds)}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${RUN_STATUS_BADGE[run.status] ?? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'}`}>
                                  {run.status}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-emerald-400 font-bold">{toNum(run.pages_success)}</span>
                                <span className="text-indigo-400/30 mx-1">/</span>
                                <span className={`font-bold ${toNum(run.pages_failed) > 0 ? 'text-rose-400' : 'text-indigo-400/30'}`}>{toNum(run.pages_failed)}</span>
                              </td>
                              <td className="px-4 py-3 font-mono text-indigo-200">{toNum(run.jobs_fetched).toLocaleString()}</td>
                              <td className="px-4 py-3 font-mono text-indigo-200">{toNum(run.jobs_inserted).toLocaleString()}</td>
                              <td className="px-4 py-3">
                                <ChevronRight className={`w-4 h-4 text-indigo-400/40 transition ${selectedRun?.id === run.id ? 'rotate-90' : ''}`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalRuns > pageSizeLimit && (
                      <div className="flex items-center justify-between px-5 py-3 bg-indigo-950/25 border-t border-indigo-950/40">
                        <span className="text-xs text-indigo-300/40 font-medium">
                          Showing {(page - 1) * pageSizeLimit + 1}–{Math.min(page * pageSizeLimit, totalRuns)} of {totalRuns} runs
                        </span>
                        <div className="flex items-center gap-1">
                          <button type="button" disabled={page === 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            className="px-2.5 py-1 rounded-md bg-indigo-900/30 border border-indigo-900/40 text-indigo-300 text-xs font-semibold hover:bg-indigo-900/50 transition disabled:opacity-30 cursor-pointer disabled:cursor-default">
                            ← Prev
                          </button>
                          {(() => {
                            const totalPages = Math.ceil(totalRuns / pageSizeLimit);
                            const pages: (number | string)[] = [];
                            for (let i = 1; i <= totalPages; i++) {
                              if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
                                pages.push(i);
                              } else if (pages[pages.length - 1] !== '...') {
                                pages.push('...');
                              }
                            }
                            return pages.map((p, idx) => (
                              <button key={idx} type="button" disabled={p === '...'}
                                onClick={() => typeof p === 'number' && setPage(p)}
                                className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                                  p === '...' ? 'text-indigo-400/30 cursor-default'
                                    : p === page ? 'bg-indigo-600 text-indigo-100 shadow cursor-default'
                                    : 'bg-indigo-900/10 border border-indigo-900/20 text-indigo-300/70 hover:bg-indigo-900/30 cursor-pointer'
                                }`}>
                                {p}
                              </button>
                            ));
                          })()}
                          <button type="button" disabled={page === Math.ceil(totalRuns / pageSizeLimit)}
                            onClick={() => setPage(p => Math.min(Math.ceil(totalRuns / pageSizeLimit), p + 1))}
                            className="px-2.5 py-1 rounded-md bg-indigo-900/30 border border-indigo-900/40 text-indigo-300 text-xs font-semibold hover:bg-indigo-900/50 transition disabled:opacity-30 cursor-pointer disabled:cursor-default">
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Selected run detail panel */}
                  {selectedRun && (
                    <div className="glass-panel flex flex-col overflow-hidden">
                      <div className="px-5 py-3 border-b border-indigo-950/40 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-indigo-400" />
                        <span className="text-sm font-bold text-indigo-200">Run #{selectedRun.id} — Metrics</span>
                        {loadingRun && <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400 ml-auto" />}
                      </div>

                      {/* Metrics overview */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 border-b border-indigo-950/40">
                        <div className="flex items-center gap-3">
                          <SuccessRing success={successPages} total={totalPages} />
                          <div>
                            <p className="text-[10px] text-indigo-300/40 uppercase font-bold tracking-wide">Success Rate</p>
                            <p className="text-sm font-bold text-indigo-100 mt-0.5">
                              {successPages}<span className="text-indigo-400/40 font-normal text-xs">/{totalPages} pages</span>
                            </p>
                          </div>
                        </div>
                        {[
                          { icon: XCircle,     label: 'Failed Pages',   value: String(failedPages), cls: failedPages > 0 ? 'text-rose-400' : 'text-indigo-400/40' },
                          { icon: Clock,       label: 'Avg Fetch Time', value: `${avgMs}ms` },
                          { icon: AlertCircle, label: 'Slowest Page',   value: `${Math.round(maxMs)}ms` },
                        ].map(({ icon: Icon, label, value, cls }) => (
                          <div key={label} className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-indigo-400">
                              <Icon className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-300/40">{label}</span>
                            </div>
                            <p className={`text-base font-bold ${cls ?? 'text-indigo-100'}`}>{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Page-level grid */}
                      {details.length > 0 && (
                        <div className="p-5 border-b border-indigo-950/40">
                          <p className="text-[10px] font-bold text-indigo-300/40 uppercase tracking-wide mb-3">Page-level Details</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                            {details.map(pg => (
                              <div key={pg.page} title={pg.error ?? undefined}
                                className={`p-2.5 rounded-lg border text-xs flex flex-col gap-1 ${
                                  pg.status === 'success'
                                    ? 'bg-emerald-500/5 border-emerald-500/15'
                                    : 'bg-rose-500/10 border-rose-500/20'
                                }`}>
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-indigo-200">p{pg.page}</span>
                                  {pg.status === 'success'
                                    ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    : <XCircle className="w-3 h-3 text-rose-400" />}
                                </div>
                                <span className="font-mono text-indigo-300/60">{toNum(pg.duration_ms)}ms</span>
                                <span className="text-indigo-400/50">{toNum(pg.jobs)} jobs</span>
                                {pg.error && <span className="text-rose-400/70 text-[9px] truncate" title={pg.error}>{pg.error}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Archived log */}
                      {selectedRun.logs && (
                        <div className="flex flex-col flex-1" style={{ minHeight: 200 }}>
                          <div className="px-5 py-2.5 border-b border-indigo-950/40 flex items-center gap-2">
                            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-xs font-bold text-indigo-300/60">Archived Log</span>
                          </div>
                          <div className="p-4 font-mono text-[10px] overflow-y-auto max-h-64 space-y-0.5" style={{ background: '#03030e' }}>
                            {selectedRun.logs.split('\n').map((line, i) => (
                              <div key={i} className={`leading-relaxed break-all ${logLineColor(line)}`}>{line}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

