/**
 * upwork-job-scraper-manager.ts
 *
 * Single-file scraper manager: token management, GraphQL page fetching,
 * database bulk-insertion, and scheduling orchestration.
 */

import fs from 'fs';
import path from 'path';
import pool from './db';

// ─── Token Manager ────────────────────────────────────────────────────────────

const UPWORK_URL = 'https://www.upwork.com/';
const TOKEN_COOKIE = 'visitor_gql_token';
const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 min

export class TokenFetchFailed extends Error {
  constructor(msg: string) { super(msg); this.name = 'TokenFetchFailed'; }
}
export class TokenExpired extends Error {
  constructor(msg: string) { super(msg); this.name = 'TokenExpired'; }
}

async function fetchToken(): Promise<string> {
  const { gotScraping } = await import('got-scraping');
  const res = await gotScraping({
    url: UPWORK_URL,
    headerGeneratorOptions: { devices: ['desktop'], operatingSystems: ['windows', 'macos'], browsers: ['chrome'] },
    timeout: { request: 30000 },
    followRedirect: true,
  });
  for (const cookie of res.headers['set-cookie'] ?? []) {
    const m = cookie.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  throw new TokenFetchFailed(`Cookie '${TOKEN_COOKIE}' not found in Upwork response.`);
}

class TokenManager {
  private _token: string | null = null;
  private _expiresAt: number | null = null;

  private isValid() { 
    return this._token != null && this._expiresAt != null && Date.now() < this._expiresAt; 
  }

  async getToken(): Promise<string> {
    if (this.isValid()) return this._token!;
    let lastErr: Error | null = null;
    for (let i = 1; i <= 3; i++) {
      try {
        this._token = await fetchToken();
        this._expiresAt = Date.now() + TOKEN_TTL_MS;
        return this._token;
      } catch (e) { 
        lastErr = e instanceof Error ? e : new Error(String(e)); 
      }
    }
    throw new TokenFetchFailed(`Failed to obtain Upwork guest token after 3 attempts: ${lastErr?.message}`);
  }

  invalidate() { 
    this._token = null; 
    this._expiresAt = null; 
  }
}

// ─── Models & Parser ──────────────────────────────────────────────────────────

interface ScrapedJob {
  cipher: string;
  title: string | null;
  description: string | null;
  link: string;
  skills: string[];
  published_date: Date;
  job_type: string;
  is_hourly: boolean;
  hourly_low: number | null;
  hourly_high: number | null;
  budget: number | null;
  duration_weeks: number | null;
  contractor_tier: number | null;
}

const TIER_MAP: Record<string, number> = { entrylevel: 1, intermediatelevel: 2, expertlevel: 3 };

function parseJob(raw: Record<string, any>): ScrapedJob | null {
  try {
    const jobData = (raw['jobTile'] ?? {})['job'] ?? {};
    const cipher: string | undefined = jobData['ciphertext'] ?? jobData['cipherText'];
    if (!cipher) return null;

    const job_type = jobData['jobType'] ?? 'UNKNOWN';
    const is_hourly = job_type.toUpperCase() === 'HOURLY';

    let hourly_low: number | null = null, hourly_high: number | null = null, budget: number | null = null;
    if (is_hourly) {
      hourly_low = jobData['hourlyBudgetMin'] != null ? Number(jobData['hourlyBudgetMin']) : null;
      hourly_high = jobData['hourlyBudgetMax'] != null ? Number(jobData['hourlyBudgetMax']) : null;
    } else {
      const amt = (jobData['fixedPriceAmount'] ?? {})['amount'];
      budget = amt != null ? Number(amt) : null;
    }

    const engKey = is_hourly ? 'hourlyEngagementDuration' : 'fixedPriceEngagementDuration';
    const weeks = (jobData[engKey] ?? {})['weeks'];
    const duration_weeks = weeks != null && !isNaN(Number(weeks)) ? Math.round(Number(weeks)) : null;

    const rawTier = jobData['contractorTier'];
    let contractor_tier: number | null = null;
    if (rawTier != null) {
      contractor_tier = typeof rawTier === 'string' ? (TIER_MAP[rawTier.toLowerCase()] ?? null) : null;
      if (contractor_tier == null) { 
        const n = Number(rawTier); 
        contractor_tier = isNaN(n) ? null : n; 
      }
    }

    return {
      cipher,
      title: raw['title'] ?? null,
      description: raw['description'] ?? null,
      link: `https://www.upwork.com/jobs/~${cipher.replace(/^~/, '')}`,
      skills: (raw['ontologySkills'] ?? []).map((s: Record<string, string>) => s['prefLabel']).filter(Boolean),
      published_date: jobData['publishTime'] ? new Date(jobData['publishTime']) : new Date(),
      job_type, is_hourly, hourly_low, hourly_high, budget, duration_weeks, contractor_tier,
    };
  } catch { 
    return null; 
  }
}

// ─── Database Operations ───────────────────────────────────────────────────────

async function insertJobs(jobs: ScrapedJob[]): Promise<number> {
  if (!jobs.length) return 0;
  let inserted = 0;
  const batchSize = 200; // chunk to stay well within PostgreSQL parameter limit

  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const values: any[] = [];
    const valueRows: string[] = [];

    batch.forEach((j, idx) => {
      const base = idx * 13;
      valueRows.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13})`);
      values.push(
        j.cipher, j.title, j.description, j.link, j.skills, j.published_date,
        j.job_type, j.is_hourly, j.hourly_low, j.hourly_high, j.budget,
        j.duration_weeks, j.contractor_tier
      );
    });

    const query = `
      INSERT INTO jobs (cipher, title, description, link, skills, published_date, job_type, is_hourly, hourly_low, hourly_high, budget, duration_weeks, contractor_tier)
      VALUES ${valueRows.join(', ')}
      ON CONFLICT (cipher) DO NOTHING
    `;
    const r = await pool.query(query, values);
    inserted += r.rowCount ?? 0;
  }
  return inserted;
}

async function getJobCount(): Promise<number> {
  const r = await pool.query('SELECT COUNT(*) as cnt FROM jobs');
  return parseInt(r.rows[0]?.cnt ?? '0', 10);
}

// ─── GraphQL Fetcher ──────────────────────────────────────────────────────────

const GQL_URL = 'https://www.upwork.com/api/graphql/v1';
const GQL_QUERY = `
query VisitorJobSearch($requestVariables: VisitorJobSearchV1Request!) {
  search { universalSearchNuxt { visitorJobSearchV1(request: $requestVariables) {
    paging { total offset count }
    results {
      id title description
      ontologySkills { prefLabel }
      jobTile { job {
        id ciphertext: cipherText jobType
        hourlyBudgetMax hourlyBudgetMin contractorTier publishTime
        hourlyEngagementDuration { weeks }
        fixedPriceAmount { amount }
        fixedPriceEngagementDuration { weeks }
      }}
    }
  }}}
}`;

interface PageStat { 
  page: number; 
  offset: number; 
  status: 'success' | 'failed'; 
  jobs: number; 
  duration_ms: number; 
  error: string | null; 
}

async function fetchPage(
  token: string, 
  offset: number, 
  pageSize: number, 
  log: (m: string) => void
): Promise<{ jobs: ScrapedJob[]; stat: PageStat }> {
  const page = Math.floor(offset / pageSize) + 1;
  const t0 = Date.now();
  const stat: PageStat = { page, offset, status: 'success', jobs: 0, duration_ms: 0, error: null };

  const { gotScraping } = await import('got-scraping');
  // Inject random human-like delay to prevent quick IP bans
  await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));

  let res;
  try {
    res = await gotScraping({
      url: GQL_URL, 
      method: 'POST',
      headers: {
        Accept: '*/*', 
        'Content-Type': 'application/json',
        Referer: 'https://www.upwork.com/nx/search/jobs/',
        'X-Upwork-Accept-Language': 'en-US',
        Authorization: `Bearer ${token}`,
      },
      json: { query: GQL_QUERY, variables: { requestVariables: { paging: { offset, count: pageSize }, userQuery: '' } } },
      headerGeneratorOptions: { devices: ['desktop'], operatingSystems: ['windows', 'macos'], browsers: ['chrome'] },
      timeout: { request: 30000 }, 
      throwHttpErrors: false,
    });
  } catch (e) {
    stat.status = 'failed'; 
    stat.error = (e as Error).message; 
    stat.duration_ms = Date.now() - t0;
    log(`Page ${page}: network error — ${stat.error}`);
    return { jobs: [], stat };
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new TokenExpired(`Token rejected (HTTP ${res.statusCode})`);
  }
  if (res.statusCode === 429) { 
    stat.status = 'failed'; 
    stat.error = 'HTTP 429'; 
    stat.duration_ms = Date.now() - t0; 
    log(`Page ${page}: rate limited (HTTP 429)`); 
    return { jobs: [], stat }; 
  }
  if (res.statusCode < 200 || res.statusCode >= 300) { 
    stat.status = 'failed'; 
    stat.error = `HTTP ${res.statusCode}`; 
    stat.duration_ms = Date.now() - t0; 
    return { jobs: [], stat }; 
  }

  let body: Record<string, unknown>;
  try { 
    body = JSON.parse(res.body); 
  } catch { 
    stat.status = 'failed'; 
    stat.error = 'JSON parse error'; 
    stat.duration_ms = Date.now() - t0; 
    return { jobs: [], stat }; 
  }

  const results: Record<string, any>[] = ((body?.data as any)?.search?.universalSearchNuxt?.visitorJobSearchV1?.results) ?? [];
  const jobs = results.map(parseJob).filter((j): j is ScrapedJob => j !== null);
  stat.jobs = jobs.length; 
  stat.duration_ms = Date.now() - t0;

  if (results.length > 0) {
    log(`Page ${page} (offset ${offset}): fetched ${jobs.length} jobs`);
  } else {
    log(`Page ${page}: no results returned`);
  }
  return { jobs, stat };
}

export interface ScraperProgress {
  pages_fetched: number;
  pages_failed: number;
  jobs_found: number;
  jobs_inserted: number;
  current_page: number;
  last_line: string;
}

async function fetchAllPages(
  token: string, 
  maxPages: number, 
  log: (m: string) => void, 
  onProgress: (p: Partial<ScraperProgress>) => void,
  signal?: AbortSignal
): Promise<{ jobs: ScrapedJob[]; pageStats: PageStat[] }> {
  const pageSize = parseInt(process.env.PAGE_SIZE ?? '50', 10);
  const allJobs: ScrapedJob[] = [];
  const allStats: PageStat[] = [];

  let pagesFetched = 0;
  let pagesFailed = 0;
  let jobsFound = 0;

  // Run 2 concurrent workers for speed and reliability
  const queue = Array.from({ length: maxPages }, (_, i) => i * pageSize);
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      if (signal?.aborted) break;
      const offset = queue[idx++];
      const { jobs, stat } = await fetchPage(token, offset, pageSize, log);
      allJobs.push(...jobs); 
      allStats.push(stat);

      if (stat.status === 'success') {
        pagesFetched++;
      } else {
        pagesFailed++;
      }
      jobsFound += jobs.length;

      onProgress({
        pages_fetched: pagesFetched,
        pages_failed: pagesFailed,
        jobs_found: jobsFound,
        current_page: stat.page
      });
    }
  }

  await Promise.allSettled([worker(), worker()]);
  allStats.sort((a, b) => a.page - b.page);
  log(`All pages finished: fetched ${allJobs.length} jobs total across ${maxPages} pages`);
  return { jobs: allJobs, pageStats: allStats };
}

// ─── Scrape Cycle Orchestration ────────────────────────────────────────────────

async function runCycle(
  tokenMgr: TokenManager, 
  maxPages: number, 
  runId: number | null, 
  log: (m: string) => void, 
  onProgress: (p: Partial<ScraperProgress>) => void,
  signal?: AbortSignal
): Promise<void> {
  const t0 = Date.now();
  const logBuffer: string[] = [];
  let status = 'success';
  let allStats: PageStat[] = [];
  let fetched = 0, inserted = 0;

  const capture = (line: string) => { 
    logBuffer.push(`${new Date().toISOString().slice(0, 19).replace('T', ' ')} [INFO] ${line}`); 
    log(line); 
  };

  try {
    const token = await tokenMgr.getToken();
    capture(`Starting scrape cycle — scanning up to ${maxPages} pages...`);
    
    const { jobs, pageStats } = await fetchAllPages(token, maxPages, capture, onProgress, signal);
    allStats = pageStats; 
    fetched = jobs.length;

    if (jobs.length > 0) {
      inserted = await insertJobs(jobs);
      onProgress({ jobs_inserted: inserted });
      capture(`Finished scrape cycle — ${fetched} jobs fetched, ${inserted} new jobs inserted | DB total: ${await getJobCount()}`);
    } else { 
      capture('Finished scrape cycle — zero jobs returned.'); 
    }
    
    if (pageStats.filter(s => s.status === 'failed').length > 0 && pageStats.filter(s => s.status === 'success').length === 0) {
      status = 'error';
    }
  } catch (e) {
    capture(`Error encountered during scrape: ${(e as Error).message}`); 
    status = 'error'; 
    throw e;
  } finally {
    if (runId !== null) {
      const sec = (Date.now() - t0) / 1000;
      try {
        await pool.query(
          `UPDATE scraper_runs 
           SET end_time=NOW(), status=$1, pages_success=$2, pages_failed=$3, jobs_fetched=$4, jobs_inserted=$5, duration_seconds=$6, details=$7, logs=$8 
           WHERE id=$9`,
          [
            status, 
            allStats.filter(s => s.status === 'success').length, 
            allStats.filter(s => s.status === 'failed').length, 
            fetched, 
            inserted, 
            sec.toFixed(2), 
            JSON.stringify(allStats), 
            logBuffer.join('\n'), 
            runId
          ]
        );
      } catch {}
    }
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function findEnvPath(): string | null {
  const c = [path.resolve(process.cwd(), '../.env'), path.resolve(process.cwd(), '.env')];
  return c.find(fs.existsSync) ?? null;
}

function lastRunPath(): string {
  const e = findEnvPath();
  return e ? path.resolve(path.dirname(e), '.last_run.json') : path.resolve(process.cwd(), '.last_run.json');
}

export type ScraperStatus = 'idle' | 'running' | 'rate-limited' | 'error';

// ─── ScraperManager ───────────────────────────────────────────────────────────

class ScraperManager {
  private status: ScraperStatus = 'idle';
  private lastRunTime: string | null = null;
  private logs: string[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private activeRunId: number | null = null;
  private runStartTime: number | null = null;
  private abortController: AbortController | null = null;
  private tokenMgr = new TokenManager();
  
  private progress: ScraperProgress = { 
    pages_fetched: 0, 
    pages_failed: 0, 
    jobs_found: 0, 
    jobs_inserted: 0, 
    current_page: 0, 
    last_line: '' 
  };

  constructor() { 
    this.loadLastRun(); 
    this.startScheduler(); 
  }

  private loadLastRun() {
    try {
      const p = lastRunPath();
      if (fs.existsSync(p)) { 
        const d = JSON.parse(fs.readFileSync(p, 'utf8')); 
        if (d.lastRunTime) { 
          this.lastRunTime = d.lastRunTime; 
          return; 
        } 
      }
    } catch {}
    pool.query('SELECT MAX(scraped_at) as m FROM jobs')
      .then((r: any) => { 
        if (r.rows[0]?.m && !this.lastRunTime) {
          this.lastRunTime = new Date(r.rows[0].m).toISOString(); 
        }
      })
      .catch(() => {});
  }

  private saveLastRun(iso: string) { 
    try { 
      fs.writeFileSync(lastRunPath(), JSON.stringify({ lastRunTime: iso })); 
    } catch {} 
  }

  private log(line: string) {
    const ts = new Date().toISOString().slice(11, 19);
    this.logs.push(`[${ts}] ${line.trim()}`);
    if (this.logs.length > 150) this.logs.shift();
    
    this.progress.last_line = line.trim().slice(0, 120);
    if (/HTTP 429|Rate limited/i.test(line)) {
      this.status = 'rate-limited';
    }
  }

  private async createRun(): Promise<number | null> {
    try { 
      const r = await pool.query("INSERT INTO scraper_runs (status) VALUES ('running') RETURNING id"); 
      return r.rows[0]?.id ?? null; 
    } catch { 
      return null; 
    }
  }

  private async failRun(id: number) {
    try { 
      await pool.query(`UPDATE scraper_runs SET end_time=NOW(), status='error', logs=$1 WHERE id=$2`, [this.logs.join('\n'), id]); 
    } catch {}
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  public getStatus() {
    return {
      status: this.status, 
      lastRunTime: this.lastRunTime, 
      logCount: this.logs.length,
      activeRunId: this.activeRunId, 
      isScheduledRunning: this.intervalId !== null,
      config: { 
        scrapeInterval: parseInt(process.env.SCRAPE_INTERVAL || '120', 10), 
        maxPages: parseInt(process.env.MAX_PAGES || '100', 10), 
        pageSize: parseInt(process.env.PAGE_SIZE || '50', 10) 
      },
    };
  }

  public getLiveProgress() { 
    return { 
      ...this.progress, 
      activeRunId: this.activeRunId, 
      status: this.status, 
      elapsed_ms: this.runStartTime ? Date.now() - this.runStartTime : 0 
    }; 
  }

  public getLogs() { 
    return this.logs; 
  }

  public updateConfig(scrapeInterval: number, maxPages: number, pageSize: number): boolean {
    try {
      this.log(`Updating configuration: interval=${scrapeInterval}s, maxPages=${maxPages}, pageSize=${pageSize}`);
      process.env.SCRAPE_INTERVAL = String(scrapeInterval); 
      process.env.MAX_PAGES = String(maxPages); 
      process.env.PAGE_SIZE = String(pageSize);
      
      const e = findEnvPath();
      if (e) {
        let c = fs.readFileSync(e, 'utf8');
        c = c.replace(/^SCRAPE_INTERVAL=.*/m, `SCRAPE_INTERVAL=${scrapeInterval}`)
             .replace(/^MAX_PAGES=.*/m, `MAX_PAGES=${maxPages}`)
             .replace(/^PAGE_SIZE=.*/m, `PAGE_SIZE=${pageSize}`);
        fs.writeFileSync(e, c, 'utf8');
        this.log(`Configuration saved to ${e}`);
      } else { 
        this.log('Configuration updated in-memory (no .env found).'); 
      }
      this.startScheduler(); 
      return true;
    } catch (e) { 
      this.log(`Configuration update failed: ${(e as Error).message}`); 
      return false; 
    }
  }

  public async triggerScrape(isManual = true): Promise<boolean> {
    if (this.status === 'running') { 
      this.log(isManual ? 'Trigger ignored (scraper already running).' : 'Scheduled trigger skipped (scraper already running).'); 
      return false; 
    }
    
    this.status = 'running';
    const now = new Date().toISOString();
    this.lastRunTime = now; 
    this.saveLastRun(now); 
    this.runStartTime = Date.now();
    
    this.progress = { 
      pages_fetched: 0, 
      pages_failed: 0, 
      jobs_found: 0, 
      jobs_inserted: 0, 
      current_page: 0, 
      last_line: '' 
    };
    
    this.log(isManual ? 'Manual scraper triggered.' : 'Scheduled scraper triggered.');
    const runId = await this.createRun(); 
    this.activeRunId = runId;
    this.abortController = new AbortController();
    
    this.runAsync(parseInt(process.env.MAX_PAGES || '100', 10), runId, this.abortController.signal);
    return true;
  }

  private async runAsync(maxPages: number, runId: number | null, signal: AbortSignal) {
    const updateProgress = (p: Partial<ScraperProgress>) => {
      this.progress = { ...this.progress, ...p };
    };

    try {
      await runCycle(this.tokenMgr, maxPages, runId, (l) => this.log(l), updateProgress, signal);
      this.log('Scrape cycle successfully completed.'); 
      this.status = 'idle';
    } catch (e) {
      if (e instanceof TokenExpired) {
        this.log('Token expired during execution. Refreshing guest token and retrying...');
        this.tokenMgr.invalidate();
        try { 
          await runCycle(this.tokenMgr, maxPages, runId, (l) => this.log(l), updateProgress, signal); 
          this.log('Retry scrape cycle successfully completed.'); 
          this.status = 'idle'; 
        } catch (e2) { 
          this.log(`Retry attempt failed: ${(e2 as Error).message}`); 
          this.status = 'error'; 
          if (runId) await this.failRun(runId); 
        }
      } else { 
        this.log(`Scraper execution error: ${(e as Error).message}`); 
        this.status = 'error'; 
        if (runId) await this.failRun(runId); 
      }
    } finally { 
      this.activeRunId = null; 
      this.runStartTime = null; 
      this.abortController = null; 
    }
  }

  public stopCurrentScrape() { 
    if (this.abortController) { 
      this.abortController.abort(); 
      this.log('Scraper execution cancelled by user.'); 
    } 
  }

  private startScheduler() {
    if (this.intervalId) clearInterval(this.intervalId);
    const sec = parseInt(process.env.SCRAPE_INTERVAL || '120', 10);
    this.log(`Scheduler started: triggers every ${sec}s`);
    this.intervalId = setInterval(() => { 
      this.status !== 'running' ? (this.log('Scheduled trigger...'), this.triggerScrape(false)) : this.log('Scheduled trigger skipped (running).'); 
    }, sec * 1000);
  }

  public stopScheduler() { 
    if (this.intervalId) { 
      clearInterval(this.intervalId); 
      this.intervalId = null; 
      this.log('Scheduler stopped.'); 
    } 
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

declare global { var globalScraperManager: ScraperManager | undefined; }
const scraperManager = globalThis.globalScraperManager || new ScraperManager();
if (process.env.NODE_ENV !== 'production') globalThis.globalScraperManager = scraperManager;

export default scraperManager;
