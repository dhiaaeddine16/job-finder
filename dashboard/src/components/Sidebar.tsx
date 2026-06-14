'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { LayoutDashboard, Briefcase, Terminal, Zap } from 'lucide-react';

type ScraperStatus = 'idle' | 'running' | 'rate-limited' | 'error';

const STATUS_DOT: Record<ScraperStatus, string> = {
  idle: 'bg-emerald-400',
  running: 'bg-blue-400 animate-pulse',
  'rate-limited': 'bg-amber-400',
  error: 'bg-rose-400',
};

const STATUS_LABEL: Record<ScraperStatus, string> = {
  idle: 'Idle',
  running: 'Scraping...',
  'rate-limited': 'Rate Limited',
  error: 'Error',
};

const NAV = [
  { href: '/',        icon: LayoutDashboard, label: 'Dashboard', sub: 'Overview & stats' },
  { href: '/jobs',    icon: Briefcase,        label: 'Jobs',      sub: 'Browse listings'  },
  { href: '/scraper', icon: Terminal,         label: 'Scraper',   sub: 'Engine & console' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus]     = useState<ScraperStatus>('idle');
  const [totalJobs, setTotalJobs] = useState<number | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const [sr, tr] = await Promise.all([fetch('/api/scraper'), fetch('/api/stats')]);
        const [sd, td] = await Promise.all([sr.json(), tr.json()]);
        if (sd?.status?.status)       setStatus(sd.status.status);
        if (td?.total_jobs != null)   setTotalJobs(td.total_jobs);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, status === 'running' ? 2000 : 10000);
    return () => clearInterval(id);
  }, [status]);

  return (
    <aside
      className="w-64 min-h-screen flex flex-col sticky top-0 h-screen overflow-y-auto shrink-0"
      style={{ background: 'rgba(6,5,20,0.97)', borderRight: '1px solid rgba(99,102,241,0.12)' }}
    >
      {/* Brand */}
      <div className="p-6 border-b border-indigo-950/50 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-extrabold text-indigo-100 leading-tight">Upwork Scraper</p>
          <p className="text-[10px] text-indigo-400/50">Analytics Dashboard</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-4 space-y-1">
        <p className="text-[10px] text-indigo-400/40 font-bold uppercase tracking-widest px-3 mb-3">
          Navigation
        </p>
        {NAV.map(({ href, icon: Icon, label, sub }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                active
                  ? 'bg-indigo-600/20 text-indigo-100 border border-indigo-500/30 shadow-lg shadow-indigo-900/20'
                  : 'text-indigo-400/60 hover:bg-indigo-950/50 hover:text-indigo-300 border border-transparent'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-400 rounded-full -ml-px" />
              )}
              <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                active
                  ? 'bg-indigo-500/20 text-indigo-300'
                  : 'bg-indigo-950/40 text-indigo-500 group-hover:bg-indigo-950/60 group-hover:text-indigo-400'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="leading-tight">{label}</div>
                <div className="text-[10px] font-normal opacity-50 mt-0.5">{sub}</div>
              </div>
              {/* Jobs count badge */}
              {href === '/jobs' && totalJobs !== null && (
                <span className="ml-auto text-[10px] font-bold bg-indigo-950/60 text-indigo-400 px-1.5 py-0.5 rounded-full border border-indigo-900/40 shrink-0">
                  {totalJobs >= 1000 ? `${(totalJobs / 1000).toFixed(1)}k` : totalJobs}
                </span>
              )}
              {/* Scraper running pulse */}
              {href === '/scraper' && status === 'running' && (
                <span className="ml-auto w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="p-4 border-t border-indigo-950/40">
        <div className="bg-indigo-950/30 border border-indigo-900/30 rounded-xl p-3">
          <p className="text-[11px] font-bold text-indigo-300 mb-1.5">Scraper Engine</p>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
            <span className="text-[11px] text-indigo-400/70 font-medium">{STATUS_LABEL[status]}</span>
          </div>
          {totalJobs !== null && (
            <p className="mt-1.5 text-[10px] text-indigo-400/40">{totalJobs.toLocaleString()} jobs indexed</p>
          )}
        </div>
      </div>
    </aside>
  );
}
