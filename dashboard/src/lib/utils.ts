// Shared types
export interface Job {
  cipher: string;
  title: string | null;
  description: string | null;
  link: string;
  skills: string[];
  published_date: string;
  job_type: string;
  hourly_low: number | null;
  hourly_high: number | null;
  budget: number | null;
  contractor_tier: number | null;
  duration_weeks: number | null;
}

export interface Stats {
  total_jobs: number;
  job_types: { hourly: number; fixed: number };
  averages: { fixed_budget: number; hourly_low: number; hourly_high: number };
  contractor_tiers: { entry: number; intermediate: number; expert: number };
  top_skills: Array<{ name: string; count: number }>;
  posting_timeline: Array<{
    date: string;
    count: number;
    hourly_count?: number;
    fixed_count?: number;
    entry_count?: number;
    intermediate_count?: number;
    expert_count?: number;
  }>;
}

// Format a timestamp as a relative string ("5m ago", "2h ago", "3d ago")
export function formatTimeAgo(dateStr: string): string {
  try {
    if (!dateStr) return '—';
    const parsed = new Date(dateStr).getTime();
    if (isNaN(parsed) || parsed <= 0) return '—';
    const ms = Date.now() - parsed;
    const mins = Math.floor(ms / 60_000);
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(ms / 86_400_000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return dateStr || '—';
  }
}

// Map contractor tier number to human-readable label
export function getTierLabel(tier: number | null): string {
  const labels: Record<number, string> = { 1: 'Entry Level', 2: 'Intermediate', 3: 'Expert' };
  return (tier !== null && labels[tier]) ? labels[tier] : 'Unknown';
}

// Format budget/rate for a job posting
export function formatBudget(job: Pick<Job, 'job_type' | 'hourly_low' | 'hourly_high' | 'budget'>): string {
  if (job.job_type === 'HOURLY') {
    return job.hourly_low !== null && job.hourly_high !== null
      ? `$${job.hourly_low}–$${job.hourly_high}/hr`
      : 'Hourly';
  }
  return job.budget !== null ? `$${job.budget}` : 'Fixed Price';
}

// Format an ISO timestamp as a short HH:MM time
export function formatShortTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// Format an ISO timestamp as a human-friendly relative duration for last run
export function formatLastRunTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    const parsed = new Date(iso).getTime();
    if (isNaN(parsed) || parsed <= 0) return 'Never';
    const ms = Date.now() - parsed;
    if (ms < 60_000) return 'Just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(ms / 86_400_000);
    return `${days}d ago`;
  } catch {
    return 'Never';
  }
}
