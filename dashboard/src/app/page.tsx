'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, ReferenceLine
} from 'recharts';
import { Briefcase, Clock, DollarSign, Layers, TrendingUp, Tag, ExternalLink, ChevronRight, RefreshCw, BarChart2 } from 'lucide-react';
import { Stats, Job, formatTimeAgo, getTierLabel, formatBudget } from '@/lib/utils';

const Skeleton = ({ w }: { w: string }) => (
  <div className={`h-7 ${w} bg-indigo-950/50 animate-pulse rounded mt-1`} />
);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-indigo-950/95 border border-indigo-500/25 px-3 py-2 rounded-lg shadow-xl backdrop-blur-md text-xs">
        <p className="font-bold text-indigo-200 mb-0.5">{label}</p>
        <p className="text-emerald-400 font-semibold">
          Jobs posted: <span className="text-indigo-100 font-bold">{payload[0].value.toLocaleString()}</span>
        </p>
      </div>
    );
  }
  return null;
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-indigo-950/95 border border-indigo-500/25 px-3 py-2 rounded-lg shadow-xl backdrop-blur-md text-xs">
        <p className="font-bold text-indigo-200 mb-0.5">{payload[0].name}</p>
        <p className="text-indigo-100 font-bold">
          Count: <span className="font-extrabold">{payload[0].value.toLocaleString()}</span> ({payload[0].payload.percent}%)
        </p>
      </div>
    );
  }
  return null;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<'hourly' | 'daily'>('hourly');
  const [selectedItem, setSelectedItem] = useState<{ raw: string; label: string } | null>(null);

  // Reset selection when changing viewMode
  useEffect(() => {
    setSelectedItem(null);
  }, [viewMode]);

  // Mount check to prevent hydration mismatch with recharts
  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchData = async () => {
    try {
      const [sr, jr] = await Promise.all([fetch('/api/stats'), fetch('/api/jobs?limit=6&offset=0')]);
      const [sd, jd] = await Promise.all([sr.json(), jr.json()]);
      if (!sd.error) setStats(sd);
      if (!jd.error) setRecent(jd.jobs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLoading(true);
    await fetchData();
    setRefreshing(false);
  };


  // Format ISO hour string "2026-06-13T14:00" → "Jun 13 14h"
  const formatHourLabel = (isoHour: string) => {
    try {
      const d = new Date(isoHour);
      const mon = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const h = String(d.getHours()).padStart(2, '0');
      return `${mon} ${h}h`;
    } catch {
      return isoHour;
    }
  };

  // Format YYYY-MM-DD → "Jun 13"
  const formatDailyLabel = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Process and aggregate timeline data based on viewMode
  const timelineData = React.useMemo(() => {
    if (!stats || !stats.posting_timeline || stats.posting_timeline.length === 0) {
      return [];
    }

    if (viewMode === 'hourly') {
      const rawTimeline = stats.posting_timeline;
      const minTime = new Date(rawTimeline[0].date).getTime();
      const maxTime = new Date(rawTimeline[rawTimeline.length - 1].date).getTime();

      const countMap = new Map<string, number>();
      rawTimeline.forEach(item => {
        countMap.set(item.date, item.count);
      });

      const filled: { hour: string; raw: string; Jobs: number }[] = [];
      const step = 60 * 60 * 1000; // 1 hour in ms

      for (let t = minTime; t <= maxTime; t += step) {
        const d = new Date(t);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const key = `${year}-${month}-${day}T${hour}:00`;

        filled.push({
          hour: formatHourLabel(key),
          raw: key,
          Jobs: countMap.get(key) || 0
        });
      }
      return filled;
    } else {
      // Group hourly counts by day (YYYY-MM-DD)
      const dailyMap: Record<string, number> = {};
      stats.posting_timeline.forEach(item => {
        const dateStr = item.date.split('T')[0];
        dailyMap[dateStr] = (dailyMap[dateStr] || 0) + item.count;
      });

      // Format to array and sort chronologically
      return Object.entries(dailyMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateStr, count]) => ({
          hour: formatDailyLabel(dateStr),
          raw: dateStr,
          Jobs: count
        }));
    }
  }, [stats, viewMode]);

  const dayColorMap = React.useMemo(() => {
    if (viewMode !== 'hourly') return new Map<string, boolean>();
    const uniqueDays = Array.from(new Set(timelineData.map(item => new Date(item.raw).toDateString())));
    const colorMap = new Map<string, boolean>();
    uniqueDays.forEach((dayStr, idx) => {
      colorMap.set(dayStr, idx % 2 === 0);
    });
    return colorMap;
  }, [timelineData, viewMode]);

  const dayBoundaries = React.useMemo(() => {
    if (viewMode !== 'hourly') return [];
    const boundaries: string[] = [];
    let lastDayStr = '';
    timelineData.forEach((item) => {
      const dayStr = new Date(item.raw).toDateString();
      if (lastDayStr && dayStr !== lastDayStr) {
        boundaries.push(item.hour);
      }
      lastDayStr = dayStr;
    });
    return boundaries;
  }, [timelineData, viewMode]);

  // Dynamically compute/filter stats based on active selection
  const activeStats = React.useMemo(() => {
    if (!stats) return null;

    if (!selectedItem) {
      return {
        total: stats.total_jobs,
        hourlyCount: stats.job_types.hourly,
        fixedCount: stats.job_types.fixed,
        contractor_tiers: stats.contractor_tiers,
        isFiltered: false,
        label: 'Overall'
      };
    }

    let hourly = 0;
    let fixed = 0;
    let entry = 0;
    let intermediate = 0;
    let expert = 0;

    stats.posting_timeline.forEach(item => {
      const isMatch = viewMode === 'hourly'
        ? item.date === selectedItem.raw
        : item.date.split('T')[0] === selectedItem.raw;

      if (isMatch) {
        hourly += item.hourly_count || 0;
        fixed += item.fixed_count || 0;
        entry += item.entry_count || 0;
        intermediate += item.intermediate_count || 0;
        expert += item.expert_count || 0;
      }
    });

    const total = hourly + fixed;

    return {
      total,
      hourlyCount: hourly,
      fixedCount: fixed,
      contractor_tiers: {
        entry,
        intermediate,
        expert
      },
      isFiltered: true,
      label: selectedItem.label
    };
  }, [stats, selectedItem, viewMode]);

  const total = activeStats?.total ?? 0;
  const hourlyCount = activeStats?.hourlyCount ?? 0;
  const fixedCount = activeStats?.fixedCount ?? 0;

  const hourlyPct = total > 0 ? Math.round((hourlyCount / total) * 100) : 0;
  const fixedPct = total > 0 ? Math.round((fixedCount / total) * 100) : 0;

  // Contractor Tier Data
  const tierData = [
    { name: 'Entry', Count: activeStats?.contractor_tiers.entry ?? 0, fill: '#10b981' },
    { name: 'Intermediate', Count: activeStats?.contractor_tiers.intermediate ?? 0, fill: '#6366f1' },
    { name: 'Expert', Count: activeStats?.contractor_tiers.expert ?? 0, fill: '#ec4899' }
  ];

  // Job Type Ratio Data
  const pieData = [
    { name: 'Hourly', value: hourlyCount, percent: hourlyPct, color: '#ec4899' },
    { name: 'Fixed Price', value: fixedCount, percent: fixedPct, color: '#10b981' }
  ];

  return (
    <div className="relative z-10 p-8">
      <div className="glow-bg-radial top-[-80px] left-[20%]" />

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-indigo-100 to-indigo-400 bg-clip-text text-transparent">
            Overview
          </h2>
          <p className="text-sm text-indigo-200/50 mt-1">Real-time summary of scraped Upwork job postings.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600/10 border border-indigo-500/20 hover:bg-indigo-600/20 text-indigo-300 text-sm font-medium transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {/* Total Jobs */}
        <div className="glass-panel glass-panel-hover p-6 flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <Briefcase className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-indigo-200/50 uppercase tracking-wider font-bold">Total Jobs</span>
            {loading ? <Skeleton w="w-20" /> : <h3 className="text-2xl font-bold text-indigo-100 mt-0.5">{total.toLocaleString()}</h3>}
          </div>
        </div>

        {/* Job Type Ratio */}
        <div className="glass-panel glass-panel-hover p-6 flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20 shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-indigo-200/50 uppercase tracking-wider font-bold">Type Ratio</span>
            {loading ? <Skeleton w="w-28" /> : (
              <div className="mt-1">
                <div className="flex justify-between text-[11px] text-indigo-300/70 mb-1 font-semibold">
                  <span>{hourlyPct}% Hr</span><span>{fixedPct}% Fix</span>
                </div>
                <div className="w-full bg-indigo-950/80 h-2 rounded-full overflow-hidden flex border border-indigo-900/30">
                  <div className="bg-pink-500 h-full" style={{ width: `${hourlyPct}%` }} />
                  <div className="bg-indigo-400 h-full" style={{ width: `${fixedPct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Avg Rates */}
        <div className="glass-panel glass-panel-hover p-6 flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <DollarSign className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <span className="text-xs text-indigo-200/50 uppercase tracking-wider font-bold">Avg Budget</span>
            {loading ? <Skeleton w="w-32" /> : (
              <div className="mt-0.5">
                <div className="text-sm font-bold text-emerald-300">
                  ${stats?.averages.fixed_budget} <span className="text-xs text-indigo-300/40 font-normal">Fixed</span>
                </div>
                <div className="text-xs font-semibold text-emerald-400/80">
                  ${stats?.averages.hourly_low}–${stats?.averages.hourly_high}/hr <span className="text-[10px] text-indigo-300/30 font-normal">Hourly</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tiers */}
        <div className="glass-panel glass-panel-hover p-6 flex items-center gap-4">
          <div className="p-3.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-indigo-200/50 uppercase tracking-wider font-bold">Tiers</span>
            {loading ? <Skeleton w="w-24" /> : (
              <div className="grid grid-cols-3 gap-1 mt-1 text-center text-[10px]">
                {[
                  { l: 'Entry', v: stats?.contractor_tiers.entry },
                  { l: 'Int', v: stats?.contractor_tiers.intermediate },
                  { l: 'Exp', v: stats?.contractor_tiers.expert },
                ].map(({ l, v }) => (
                  <div key={l} className="bg-indigo-950/40 border border-indigo-900/20 rounded py-1">
                    <div className="text-purple-400 text-sm font-bold">{v}</div>
                    <div className="text-[8px] text-indigo-300/40 uppercase">{l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Visual Analytics Charts Section */}
      {mounted && stats && !loading && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          <div className="lg:col-span-8 glass-panel p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-base font-bold text-indigo-200 flex items-center gap-2 flex-wrap">
                  <BarChart2 className="w-5 h-5 text-indigo-400" />
                  <span>Posting Activity (Last 7 Days)</span>
                  {selectedItem && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItem(null);
                      }}
                      className="text-[10px] bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full font-medium transition cursor-pointer flex items-center gap-1"
                    >
                      Clear Filter ({selectedItem.label})
                    </button>
                  )}
                </h3>
                <span className="text-[10px] text-indigo-300/40 font-semibold uppercase tracking-wider">
                  Click a bar to filter dashboard metrics
                </span>
              </div>

              {/* Toggle Buttons */}
              <div className="flex items-center bg-indigo-950/60 p-0.5 rounded-lg border border-indigo-500/20 self-start sm:self-auto">
                <button
                  onClick={() => setViewMode('hourly')}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-md transition ${viewMode === 'hourly'
                      ? 'bg-indigo-600 text-indigo-100 shadow-md shadow-indigo-600/20'
                      : 'text-indigo-300/70 hover:text-indigo-200'
                    }`}
                >
                  Hourly
                </button>
                <button
                  onClick={() => setViewMode('daily')}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-md transition ${viewMode === 'daily'
                      ? 'bg-indigo-600 text-indigo-100 shadow-md shadow-indigo-600/20'
                      : 'text-indigo-300/70 hover:text-indigo-200'
                    }`}
                >
                  Daily
                </button>
              </div>
            </div>

            {timelineData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-indigo-400/40 text-sm">
                No posting activity recorded in the last 7 days.
              </div>
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }} barCategoryGap={viewMode === 'hourly' ? "10%" : "25%"}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.12)" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      stroke="#818cf8"
                      opacity={0.5}
                      fontSize={9}
                      tickLine={false}
                      angle={viewMode === 'hourly' ? -45 : 0}
                      textAnchor={viewMode === 'hourly' ? 'end' : 'middle'}
                      interval={viewMode === 'hourly' ? Math.max(0, Math.floor(timelineData.length / 24) - 1) : 0}
                      tick={{ fill: '#818cf8', opacity: 0.6 }}
                    />
                    <YAxis
                      stroke="#818cf8"
                      opacity={0.5}
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />

                    {/* Render day boundary lines only in hourly view */}
                    {viewMode === 'hourly' && dayBoundaries.map((boundary) => (
                      <ReferenceLine
                        key={boundary}
                        x={boundary}
                        stroke="rgba(139, 92, 246, 0.4)"
                        strokeDasharray="3 3"
                        strokeWidth={1.5}
                      />
                    ))}

                    <Bar
                      dataKey="Jobs"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={viewMode === 'hourly' ? 12 : 40}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const raw = data?.raw || data?.payload?.raw;
                        const label = data?.hour || data?.payload?.hour;
                        if (raw && label) {
                          setSelectedItem(prev =>
                            prev && prev.raw === raw
                              ? null
                              : { raw, label }
                          );
                        }
                      }}
                    >
                      {timelineData.map((entry, index) => {
                        let fill = 'rgba(99, 102, 241, 0.6)';
                        const isSelected = selectedItem && selectedItem.raw === entry.raw;

                        if (viewMode === 'hourly') {
                          const dayStr = new Date(entry.raw).toDateString();
                          const isEvenDay = dayColorMap.get(dayStr);
                          const baseColor = isEvenDay ? '99, 102, 241' : '139, 92, 246'; // Indigo vs Purple
                          fill = `rgba(${baseColor}, ${0.45 + (index % 3) * 0.15})`;
                        } else {
                          // Daily view: Indigo color variance
                          fill = `rgba(99, 102, 241, ${0.6 + (index % 3) * 0.15})`;
                        }

                        // Apply selection opacity
                        let opacity = 1.0;
                        if (selectedItem) {
                          if (isSelected) {
                            fill = '#38bdf8'; // neon sky blue highlight
                          } else {
                            opacity = 0.25; // dim other bars
                          }
                        }

                        return (
                          <Cell
                            key={`bar-${index}`}
                            fill={fill}
                            style={{ opacity, transition: 'opacity 0.2s ease, fill 0.2s ease' }}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Job Type & Level breakdown */}
          <div className="lg:col-span-4 glass-panel p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-indigo-200 mb-4 flex items-center gap-2 flex-wrap">
                <Clock className="w-5 h-5 text-pink-400" />
                <span>Type & Level Ratios</span>
                {activeStats?.isFiltered && (
                  <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-semibold ml-auto animate-fade-in">
                    {activeStats.label}
                  </span>
                )}
              </h3>
              <div className="flex justify-center items-center h-[160px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                {/* Donut Center */}
                <div className="absolute text-center">
                  <span className="text-[10px] text-indigo-300/40 uppercase font-semibold">Total</span>
                  <p className="text-lg font-extrabold text-indigo-100">{total.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Micro Details under Donut */}
            <div className="grid grid-cols-2 gap-4 mt-2">
              {pieData.map(d => (
                <div key={d.name} className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-2 text-center">
                  <span className="text-[10px] font-bold text-indigo-300/50 block">{d.name}</span>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-sm font-bold text-indigo-100">{d.percent}%</span>
                  </div>
                  <span className="text-[9px] text-indigo-300/30">{d.value.toLocaleString()} jobs</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Tiers Distribution Bar Chart Section */}
      {mounted && stats && !loading && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          {/* Level Distribution Chart */}
          <div className="lg:col-span-12 glass-panel p-6">
            <h3 className="text-base font-bold text-indigo-200 mb-4 flex items-center gap-2 flex-wrap">
              <Layers className="w-5 h-5 text-purple-400" />
              <span>Contractor Experience Level Distribution</span>
              {activeStats?.isFiltered && (
                <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-semibold ml-auto animate-fade-in">
                  {activeStats.label}
                </span>
              )}
            </h3>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tierData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1b4b/30" vertical={false} />
                  <XAxis dataKey="name" stroke="#818cf8" opacity={0.5} fontSize={10} tickLine={false} />
                  <YAxis stroke="#818cf8" opacity={0.5} fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(99, 102, 241, 0.05)' }} formatter={(value) => [value, 'Jobs Count']} labelStyle={{ color: '#818cf8' }} contentStyle={{ backgroundColor: '#090514', borderColor: '#4338ca' }} />
                  <Bar dataKey="Count" radius={[6, 6, 0, 0]}>
                    {tierData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Bottom: Skills + Recent Jobs */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Top Skills */}
        <div className="xl:col-span-4 glass-panel p-6">
          <h3 className="text-base font-bold text-indigo-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            In-Demand Skills
          </h3>
          {loading ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-7 bg-indigo-950/50 animate-pulse rounded" />)}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {stats?.top_skills.slice(0, 12).map((skill, i) => {
                const pct = Math.round((skill.count / (stats.top_skills[0]?.count || 1)) * 100);
                return (
                  <div key={skill.name}>
                    <div className="flex justify-between text-xs font-semibold text-indigo-200 mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-indigo-500 text-[10px] w-4 text-right">{i + 1}.</span>
                        {skill.name}
                      </span>
                      <span className="text-indigo-400/70">{skill.count.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-indigo-950/60 h-1.5 rounded-full overflow-hidden border border-indigo-900/10">
                      <div className="bg-gradient-to-r from-indigo-600 to-indigo-400 h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Jobs */}
        <div className="xl:col-span-8 glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-indigo-200 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-indigo-400" />
              Recent Postings
            </h3>
            <Link href="/jobs" className="flex items-center gap-1 text-xs font-bold text-indigo-400 hover:text-indigo-200 transition">
              View All <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="flex flex-col gap-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-indigo-950/40 animate-pulse rounded-xl" />)}</div>
          ) : recent.length === 0 ? (
            <div className="text-center py-12 text-indigo-400/40">
              <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No jobs yet — run the scraper first.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recent.map(job => (
                <div
                  key={job.cipher}
                  className="flex items-start justify-between gap-4 p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/30 hover:border-indigo-700/40 hover:bg-indigo-950/30 transition group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-indigo-100 truncate">{job.title || 'Untitled'}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-indigo-400/60">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTimeAgo(job.published_date)}</span>
                      <span>{getTierLabel(job.contractor_tier)}</span>
                      {job.skills.slice(0, 2).map(s => (
                        <span key={s} className="flex items-center gap-0.5"><Tag className="w-2.5 h-2.5" />{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${job.job_type === 'HOURLY'
                        ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>{formatBudget(job)}</span>
                    <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-300 transition">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              ))}
              <Link
                href="/jobs"
                className="mt-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-indigo-900/50 text-xs font-semibold text-indigo-400/50 hover:text-indigo-300 hover:border-indigo-700/60 transition"
              >
                Browse all jobs <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
