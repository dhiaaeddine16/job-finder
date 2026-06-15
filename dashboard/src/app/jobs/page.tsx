'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, ExternalLink, Clock, Layers, Tag, ChevronDown, ChevronUp, RefreshCw, SearchCode, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Job, Stats, formatTimeAgo, getTierLabel, formatBudget } from '@/lib/utils';

const PAGE_SIZE = 15;

const Highlight = ({ text, search, active, strict = false }: { text: string | null; search: string; active: boolean; strict?: boolean }) => {
  if (!text) return null;
  if (!search.trim() || !active) return <>{text}</>;

  try {
    const escaped = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // In strict mode use word boundaries (\b); in partial mode use simple substring
    const pattern = strict ? `\\b${escaped}\\b` : escaped;
    const regex = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-indigo-500/40 text-indigo-100 px-0.5 rounded-sm border-b border-indigo-400/80">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
};

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState('both');
  const [searchMatch, setSearchMatch] = useState('partial'); // 'partial' | 'strict'
  const [jobType, setJobType] = useState('');
  const [tier, setTier] = useState('');
  const [skill, setSkill] = useState('');
  // Multi-select searchable skills
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillSuggestions, setSkillSuggestions] = useState<{ name: string; count: number }[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [duration, setDuration] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [offset, setOffset] = useState(0);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [topSkills, setTopSkills] = useState<Stats['top_skills']>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // When selectedSkills change, keep the single-skill `skill` for backward compat UI pieces
  useEffect(() => {
    if (selectedSkills.length === 1) {
      setSkill(selectedSkills[0]);
    } else {
      setSkill('');
    }
  }, [selectedSkills]);

  // Single fetch: jobs + skills (skills only on first load)
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams: Record<string, string> = {
        search,
        search_scope: searchScope,
        search_match: searchMatch,
        job_type: jobType,
        contractor_tier: tier,
        // pass selectedSkills as repeated skills param
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort_by: sortBy,
      };

      if (selectedSkills.length > 0) {
        // We'll append skills after creating URLSearchParams
      }

      if (minBudget) queryParams.min_budget = minBudget;
      if (maxBudget) queryParams.max_budget = maxBudget;
      if (duration) queryParams.duration = duration;

      const params = new URLSearchParams(queryParams);
      // append repeated skills values
      selectedSkills.forEach(s => params.append('skills', s));

      const [jr, sr] = await Promise.all([
        fetch(`/api/jobs?${params}`),
        topSkills.length === 0 ? fetch('/api/stats') : Promise.resolve(null),
      ]);
      const jd = await jr.json();
      if (!jd.error) { setJobs(jd.jobs ?? []); setTotal(jd.pagination?.total ?? 0); }
      if (sr) { const sd = await sr.json(); if (!sd.error) setTopSkills(sd.top_skills ?? []); }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, searchScope, searchMatch, jobType, tier, selectedSkills, minBudget, maxBudget, duration, sortBy, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
  }, [fetchJobs]);

  // Debounced skill suggestions fetch
  useEffect(() => {
    let mounted = true;
    const handle = setTimeout(async () => {
      if (!skillQuery) {
        setSkillSuggestions([]);
        return;
      }
      setSuggestLoading(true);
      try {
        const params = new URLSearchParams({ q: skillQuery, limit: '50' });
        const res = await fetch(`/api/skills?${params}`);
        const jd = await res.json();
        if (mounted && !jd.error) {
          // filter out already selected skills
          const filtered = (jd.skills ?? []).filter((r: any) => !selectedSkills.includes(r.name));
          setSkillSuggestions(filtered);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setSuggestLoading(false);
      }
    }, 250);

    return () => { mounted = false; clearTimeout(handle); };
  }, [skillQuery, selectedSkills]);

  // Helpers to add/remove skills and trigger fetch
  const addSkill = (name: string) => {
    setSelectedSkills(prev => prev.includes(name) ? prev : [...prev, name]);
    setSkillQuery('');
    setShowSuggestions(false);
    setOffset(0);
  };

  const removeSkill = (name: string) => {
    setSelectedSkills(prev => prev.filter(s => s !== name));
    setOffset(0);
  };

  const filter = (type: string, val: string) => {
    setOffset(0);
    if (type === 'search') setSearch(val);
    if (type === 'search_scope') setSearchScope(val);
    if (type === 'search_match') setSearchMatch(val);
    if (type === 'type') setJobType(val);
    if (type === 'tier') setTier(val);
    if (type === 'skill') setSkill(s => s === val ? '' : val);
    if (type === 'min_budget') setMinBudget(val);
    if (type === 'max_budget') setMaxBudget(val);
    if (type === 'duration') setDuration(val);
    if (type === 'sort_by') setSortBy(val);
    if (type === 'toggle_skill') {
      // toggle and trigger fetch by updating selectedSkills
      setSelectedSkills(prev => {
        const next = prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val];
        return next;
      });
    }
  };

  const resetFilters = () => {
    setOffset(0);
    setSearch('');
    setSearchScope('both');
    setSearchMatch('partial');
    setJobType('');
    setTier('');
    setSkill('');
    setSelectedSkills([]);
    setSkillQuery('');
    setMinBudget('');
    setMaxBudget('');
    setDuration('');
    setSortBy('newest');
  };

  const hasActiveFilters = !!(search || jobType || tier || skill || selectedSkills.length > 0 || minBudget || maxBudget || duration || sortBy !== 'newest' || searchScope !== 'both' || searchMatch !== 'partial');

  return (
    <div className="relative z-10 p-8">
      <div className="glow-bg-radial top-[-80px] left-[30%]" />

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-indigo-100 to-indigo-400 bg-clip-text text-transparent">
          Job Listings
        </h2>
        <p className="text-sm text-indigo-200/50 mt-1">{total.toLocaleString()} listings indexed — filter below.</p>
      </div>

      {/* Filters */}
      <div className="glass-panel p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Search Query</label>
            <div className="relative">
              <input
                type="text" placeholder="Python, React, Automation..."
                value={search} onChange={e => filter('search', e.target.value)}
                className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg pl-10 pr-12 py-2.5 text-sm text-indigo-100 placeholder-indigo-300/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition"
              />
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-indigo-400/40" />
              {/* Match Whole Word toggle */}
              <button
                onClick={() => filter('search_match', searchMatch === 'strict' ? 'partial' : 'strict')}
                title="Match Whole Word"
                className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded flex items-center justify-center transition border ${searchMatch === 'strict'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-500/10'
                    : 'bg-transparent border-transparent text-indigo-400/50 hover:text-indigo-300 hover:bg-indigo-950/50'
                  }`}
              >
                <span className="relative font-mono font-bold text-xs tracking-tighter select-none">
                  ab
                  <span className={`absolute left-0 right-0 bottom-[-1px] h-[1.5px] ${searchMatch === 'strict' ? 'bg-indigo-400' : 'bg-indigo-400/40 group-hover:bg-indigo-300'
                    }`} />
                </span>
              </button>
            </div>
          </div>

          {/* Search Scope */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Search In</label>
            <select value={searchScope} onChange={e => filter('search_scope', e.target.value)}
              className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-semibold cursor-pointer">
              <option value="both" className="bg-indigo-950">Title & Details</option>
              <option value="title" className="bg-indigo-950">Title Only</option>
              <option value="description" className="bg-indigo-950">Details Only</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Sort By</label>
            <select value={sortBy} onChange={e => filter('sort_by', e.target.value)}
              className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-semibold cursor-pointer">
              <option value="newest" className="bg-indigo-950">Newest Postings</option>
              <option value="highest_budget" className="bg-indigo-950">Highest Fixed Budget</option>
              <option value="highest_hourly" className="bg-indigo-950">Highest Hourly Rate</option>
              <option value="oldest" className="bg-indigo-950">Oldest Postings</option>
            </select>
          </div>

          {/* Job Type */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Job Type</label>
            <select value={jobType} onChange={e => filter('type', e.target.value)}
              className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-semibold cursor-pointer">
              <option value="" className="bg-indigo-950">All Types</option>
              <option value="HOURLY" className="bg-indigo-950">Hourly</option>
              <option value="FIXED" className="bg-indigo-950">Fixed Price</option>
            </select>
          </div>

          {/* Experience level */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Experience</label>
            <select value={tier} onChange={e => filter('tier', e.target.value)}
              className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-semibold cursor-pointer">
              <option value="" className="bg-indigo-950">All Levels</option>
              <option value="1" className="bg-indigo-950">Entry</option>
              <option value="2" className="bg-indigo-950">Intermediate</option>
              <option value="3" className="bg-indigo-950">Expert</option>
            </select>
          </div>

          {/* Duration */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Duration</label>
            <select value={duration} onChange={e => filter('duration', e.target.value)}
              className="w-full bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-semibold cursor-pointer">
              <option value="" className="bg-indigo-950">Any Duration</option>
              <option value="less_than_1m" className="bg-indigo-950">Under 1 Month</option>
              <option value="1_to_3m" className="bg-indigo-950">1 to 3 Months</option>
              <option value="more_than_3m" className="bg-indigo-950">3+ Months</option>
            </select>
          </div>

          {/* Budget Range */}
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-indigo-200/60 mb-1.5 uppercase tracking-wide">Budget Range ($)</label>
            <div className="flex gap-2">
              <input
                type="number" min="0" placeholder="Min"
                value={minBudget} onChange={e => filter('min_budget', e.target.value)}
                className="w-1/2 bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-100 placeholder-indigo-300/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition"
              />
              <input
                type="number" min="0" placeholder="Max"
                value={maxBudget} onChange={e => filter('max_budget', e.target.value)}
                className="w-1/2 bg-indigo-950/50 border border-indigo-900/60 rounded-lg px-3 py-2.5 text-sm text-indigo-100 placeholder-indigo-300/30 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition"
              />
            </div>
          </div>
        </div>

        {/* Skill tags + Reset */}
        {(topSkills.length > 0 || hasActiveFilters) && (
          <div className="mt-4 pt-4 border-t border-indigo-950/50 flex flex-wrap items-center gap-2">
            <span className="text-xs text-indigo-400/50 font-bold uppercase tracking-wider mr-1 shrink-0">Skills:</span>

            {/* Selected skill chips */}
            {selectedSkills.map(s => (
              <div key={s} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border bg-indigo-600 border-indigo-500 text-indigo-100">
                {s}
                <button onClick={() => removeSkill(s)} className="ml-2 text-xs opacity-80">×</button>
              </div>
            ))}

            {/* Searchable input */}
            <div className="relative ml-2">
              <input
                type="text"
                placeholder="Search skills..."
                value={skillQuery}
                onChange={e => { setSkillQuery(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                className="min-w-[200px] bg-indigo-950/40 border border-indigo-900/30 rounded-lg px-3 py-2 text-sm text-indigo-100 placeholder-indigo-300/40 focus:outline-none focus:border-indigo-500"
              />

              {/* Suggestions dropdown */}
              {showSuggestions && (
                <div className="absolute left-0 mt-1 w-[300px] max-h-56 overflow-auto bg-indigo-950/60 border border-indigo-900/50 rounded shadow-lg z-40">
                  {suggestLoading ? (
                    <div className="p-2 text-sm text-indigo-300">Loading...</div>
                  ) : (
                    skillSuggestions.map(s => (
                      <div key={s.name} className="px-3 py-2 text-sm hover:bg-indigo-900/40 cursor-pointer flex justify-between items-center"
                        onMouseDown={() => { addSkill(s.name); setSkillQuery(''); setShowSuggestions(false); }}>
                        <span>{s.name}</span>
                        <span className="text-xs opacity-50">{s.count}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Fallback top skills buttons (show first 10 as quick picks) */}
            {topSkills.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 ml-2">
                {topSkills.slice(0, 10).map(s => (
                  <button key={s.name} onClick={() => filter('toggle_skill', s.name) }
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${selectedSkills.includes(s.name)
                        ? 'bg-indigo-600 border-indigo-500 text-indigo-100'
                        : 'bg-indigo-950/40 border-indigo-900/40 text-indigo-300 hover:border-indigo-700/50 hover:text-indigo-200'
                      }`}>
                    {s.name} <span className="text-[10px] opacity-50">({s.count})</span>
                  </button>
                ))}
              </div>
            )}

            {hasActiveFilters && (
              <button onClick={resetFilters} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-pink-500/25 bg-pink-500/10 text-xs font-semibold text-pink-400 hover:bg-pink-500/20 hover:text-pink-300 transition">
                <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-extrabold text-indigo-100">
          {total.toLocaleString()} Jobs
          {hasActiveFilters && <span className="ml-2 text-xs font-normal text-indigo-400/60">filtered</span>}
        </h3>
        {loading && <span className="text-xs text-indigo-400 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Loading...</span>}
      </div>

      {/* List */}
      {jobs.length === 0 ? (
        <div className="glass-panel p-16 text-center">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-sm text-indigo-300/60">Fetching listings...</p>
            </div>
          ) : (
            <>
              <SearchCode className="w-12 h-12 text-indigo-700 mx-auto mb-4" />
              <h4 className="text-lg font-bold text-indigo-200">No matching jobs</h4>
              <p className="text-sm text-indigo-300/40 mt-1">Try clearing some filters.</p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.map(job => {
            const open = expanded[job.cipher] || false;
            return (
              <article key={job.cipher} className="glass-panel p-6 flex flex-col gap-3 border border-indigo-950/50 hover:border-indigo-500/25 transition">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <h4 className="text-base font-bold text-indigo-100 leading-snug">
                      <Highlight text={job.title} search={search} active={searchScope === 'both' || searchScope === 'title'} strict={searchMatch === 'strict'} />
                    </h4>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-indigo-300/50">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTimeAgo(job.published_date)}</span>
                      <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{getTierLabel(job.contractor_tier)}</span>
                      {job.duration_weeks && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Duration: {job.duration_weeks}w</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${job.job_type === 'HOURLY'
                        ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>{formatBudget(job)}</div>
                    <span className="text-[10px] text-indigo-300/30 uppercase block mt-1 tracking-wider">
                      {job.job_type === 'HOURLY' ? 'Hourly' : 'Fixed'}
                    </span>
                  </div>
                </div>

                <div className="text-sm text-indigo-100/75 leading-relaxed font-light whitespace-pre-line break-words">
                  <Highlight
                    text={open ? job.description : (job.description ? `${job.description.slice(0, 260)}${job.description.length > 260 ? '...' : ''}` : '')}
                    search={search}
                    active={searchScope === 'both' || searchScope === 'description'}
                    strict={searchMatch === 'strict'}
                  />
                  {(job.description?.length ?? 0) > 260 && (
                    <button
                      onClick={() => setExpanded(p => ({ ...p, [job.cipher]: !p[job.cipher] }))}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 ml-1.5 inline-flex items-center gap-0.5"
                    >
                      {open ? <>Show Less <ChevronUp className="w-3 h-3" /></> : <>Read More <ChevronDown className="w-3 h-3" /></>}
                    </button>
                  )}
                </div>

                {job.skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {job.skills.map(s => (
                      <button key={s} onClick={() => filter('toggle_skill', s)}
                        className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border transition ${selectedSkills.includes(s)
                            ? 'bg-indigo-600/20 border-indigo-400/70 text-indigo-200'
                            : 'bg-indigo-950/30 border-indigo-900/30 text-indigo-300/60 hover:border-indigo-700/40 hover:text-indigo-200'
                          }`}>
                        <Tag className="w-2.5 h-2.5 opacity-60" />{s}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t border-indigo-950/30">
                  <a href={job.link} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-200 transition animate-pulse-hover">
                    Apply on Upwork <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex justify-between items-center py-5 mt-4 border-t border-indigo-950/20">
          <span className="text-xs text-indigo-300/50">
            Showing <strong className="text-indigo-200">{offset + 1}</strong>–<strong className="text-indigo-200">{Math.min(offset + PAGE_SIZE, total)}</strong> of <strong className="text-indigo-200">{total.toLocaleString()}</strong>
          </span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-900/60 bg-indigo-950/20 text-indigo-300 hover:bg-indigo-950/50 transition disabled:opacity-30 disabled:pointer-events-none">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-900/60 bg-indigo-950/20 text-indigo-300 hover:bg-indigo-950/50 transition disabled:opacity-30 disabled:pointer-events-none">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
