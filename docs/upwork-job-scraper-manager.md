# `upwork-job-scraper-manager.ts` — Documentation

> **Location:** `dashboard/src/lib/upwork-job-scraper-manager.ts`  
> **Purpose:** Single-file scraper manager for Upwork jobs — handles authentication, data fetching, parsing, database storage, and scheduled execution.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Environment Variables](#environment-variables)
4. [Exported Types & Interfaces](#exported-types--interfaces)
5. [Error Classes](#error-classes)
6. [Internal Modules](#internal-modules)
   - [Token Manager](#token-manager)
   - [Job Model & Parser](#job-model--parser)
   - [Database Operations](#database-operations)
   - [GraphQL Fetcher](#graphql-fetcher)
   - [Scrape Cycle Orchestrator](#scrape-cycle-orchestrator)
7. [ScraperManager Class (Public API)](#scrapermanager-class-public-api)
8. [Singleton Export](#singleton-export)
9. [Data Flow Diagram](#data-flow-diagram)
10. [Caveats & Known Limitations](#caveats--known-limitations)

---

## Overview

`upwork-job-scraper-manager.ts` is a self-contained TypeScript module that:

- **Authenticates** with Upwork's API by extracting a guest `visitor_gql_token` cookie from an HTTP visit to `upwork.com` using browser-impersonating requests.
- **Fetches** Upwork job listings from the GraphQL endpoint (`/api/graphql/v1`) in configurable paginated batches.
- **Parses** raw GraphQL results into structured `ScrapedJob` objects.
- **Inserts** new jobs into the PostgreSQL `jobs` table using efficient batched bulk-upserts.
- **Schedules** recurring scrape cycles at a configurable interval.
- **Logs** scrape run details (page stats, timing, errors) into the `scraper_runs` table.
- **Exposes** a clean public API as a global singleton for use by Next.js API routes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ScraperManager (Singleton)                       │
│                                                                         │
│  ┌──────────────┐   ┌──────────────────────────────────────────────┐   │
│  │   Scheduler  │──▶│               triggerScrape()                │   │
│  └──────────────┘   └──────────────────────────────────────────────┘   │
│                                      │                                  │
│                                      ▼                                  │
│                           ┌─────────────────┐                          │
│                           │   runCycle()    │                          │
│                           └─────────────────┘                          │
│                                      │                                  │
│         ┌────────────────────────────┼──────────────────────┐          │
│         ▼                            ▼                       ▼          │
│  ┌─────────────┐          ┌──────────────────┐    ┌──────────────────┐ │
│  │TokenManager │          │  fetchAllPages() │    │  insertJobs()    │ │
│  │  getToken() │          │  (2 concurrent   │    │ (batched upsert) │ │
│  │  invalidate │          │   workers)       │    └──────────────────┘ │
│  └─────────────┘          └──────────────────┘            │            │
│         │                          │                       ▼            │
│         ▼                          ▼                  PostgreSQL        │
│  got-scraping            fetchPage() → parseJob()     jobs table        │
│  (browser TLS)           (GraphQL API)                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://upwork:upwork_dev@localhost:5432/upwork` | PostgreSQL connection string |
| `SCRAPE_INTERVAL` | `120` | Seconds between scheduled scrape cycles |
| `MAX_PAGES` | `100` | Maximum number of pages to fetch per cycle (50 jobs/page = 5,000 jobs/cycle) |
| `PAGE_SIZE` | `50` | Number of jobs per GraphQL page request |

---

## Exported Types & Interfaces

### `ScraperStatus`

```typescript
export type ScraperStatus = 'idle' | 'running' | 'rate-limited' | 'error';
```

Represents the current operational state of the scraper.

| Value | Description |
|---|---|
| `idle` | No scrape running, ready to start |
| `running` | A scrape cycle is actively in progress |
| `rate-limited` | Upwork returned HTTP 429; may retry on next cycle |
| `error` | The last scrape cycle terminated with an error |

---

### `ScraperProgress`

```typescript
export interface ScraperProgress {
  pages_fetched: number;
  pages_failed: number;
  jobs_found: number;
  jobs_inserted: number;
  current_page: number;
  last_line: string;
}
```

Tracks real-time progress of an active scrape cycle. Used by the `/api/scraper/stream` SSE endpoint to push live updates to the dashboard UI.

| Field | Description |
|---|---|
| `pages_fetched` | Number of pages successfully fetched so far |
| `pages_failed` | Number of pages that returned errors or non-2xx status |
| `jobs_found` | Total job records parsed from all fetched pages |
| `jobs_inserted` | Number of new (non-duplicate) jobs written to the database |
| `current_page` | Most recently fetched page number |
| `last_line` | Most recent log message (truncated to 120 chars) |

---

## Error Classes

### `TokenFetchFailed`

```typescript
export class TokenFetchFailed extends Error
```

Thrown when the scraper cannot obtain a valid Upwork guest authentication token after 3 retry attempts. This typically indicates Upwork's homepage is unreachable or the cookie format has changed.

---

### `TokenExpired`

```typescript
export class TokenExpired extends Error
```

Thrown mid-scrape when Upwork's GraphQL API returns HTTP `401` or `403`. This signals that the cached token has been revoked or expired. The `ScraperManager` catches this and automatically refreshes the token and retries the cycle.

---

## Internal Modules

### Token Manager

The `TokenManager` class manages the Upwork guest authentication token lifecycle.

#### How token acquisition works

1. Makes an HTTP GET request to `https://www.upwork.com/` using `got-scraping` with desktop Chrome browser impersonation.
2. Parses the `Set-Cookie` response headers to extract the `visitor_gql_token` cookie value.
3. Caches the token in memory with a **25-minute TTL**.
4. On subsequent calls to `getToken()`, returns the cached token if still valid.
5. Retries up to **3 times** on failure before throwing `TokenFetchFailed`.

#### Why browser impersonation matters

Upwork checks TLS fingerprints to detect scraper traffic. The `got-scraping` library emulates a real Chrome browser's TLS handshake and HTTP headers to pass these checks.

> **Note:** `got-scraping` is imported using dynamic `await import('got-scraping')` inside function bodies. This prevents Turbopack/Webpack from bundling it at build time, since it loads fingerprinting data from disk at runtime.

---

### Job Model & Parser

#### `ScrapedJob` interface (internal)

```typescript
interface ScrapedJob {
  cipher: string;           // Unique job ID (ciphertext from Upwork)
  title: string | null;
  description: string | null;
  link: string;             // Full Upwork job URL
  skills: string[];         // Array of required skill labels
  published_date: Date;
  job_type: string;         // 'HOURLY' | 'FIXED' | 'UNKNOWN'
  is_hourly: boolean;
  hourly_low: number | null;
  hourly_high: number | null;
  budget: number | null;    // Fixed-price budget in USD
  duration_weeks: number | null;
  contractor_tier: number | null; // 1=Entry, 2=Intermediate, 3=Expert
}
```

#### `parseJob(raw)` (internal)

Transforms a raw GraphQL result object into a `ScrapedJob`. Returns `null` if the record lacks a cipher (job ID), which is used as the primary key.

**Contractor tier mapping:**

| Upwork string | Stored value |
|---|---|
| `EntryLevel` | `1` |
| `IntermediateLevel` | `2` |
| `ExpertLevel` | `3` |

---

### Database Operations

#### `insertJobs(jobs: ScrapedJob[]): Promise<number>`

Performs a batched bulk upsert into the `jobs` PostgreSQL table.

- **Batch size:** 200 records per query (keeps well within PostgreSQL's 65,535 parameter limit of 13 columns × 200 = 2,600 params).
- **Conflict handling:** `ON CONFLICT (cipher) DO NOTHING` — duplicates are silently skipped.
- **Returns:** The total count of newly inserted rows.

#### `getJobCount(): Promise<number>`

Returns the total number of job records currently in the database.

---

### GraphQL Fetcher

#### GraphQL Query

The scraper uses Upwork's `VisitorJobSearchV1` GraphQL query (visitor-safe fields only):

```graphql
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
}
```

> **Why only visitor-safe fields?** Upwork's guest token (`visitor_gql_token`) lacks OAuth2 scopes for client metadata fields (e.g., `client`, `totalApplicants`, `occupancy`, `weeklyBudget`). Requesting unauthorized fields causes the GraphQL gateway to abort the entire query and return 0 results.

#### `fetchPage(token, offset, pageSize, log)` (internal)

Fetches a single page of job listings.

- Injects a **random delay of 0.5–2.5 seconds** before each request to simulate human-like browsing behavior and reduce rate-limit risk.
- Returns `PageStat` object with timing, job count, and error info.
- Throws `TokenExpired` on HTTP 401/403.
- Gracefully handles HTTP 429 (rate limited) by returning an empty result with `status: 'failed'`.

#### `fetchAllPages(token, maxPages, log, onProgress, signal)` (internal)

Dispatches `maxPages` page fetches using **2 concurrent worker coroutines**.

- Workers consume from a shared offset queue.
- Each worker calls `onProgress()` after each page to update the live progress in real time.
- Respects the `AbortSignal` to stop mid-run when the user cancels the scrape.

---

### Scrape Cycle Orchestrator

#### `runCycle(tokenMgr, maxPages, runId, log, onProgress, signal)` (internal)

Orchestrates one complete scrape cycle:

1. Obtains a valid auth token from `TokenManager`.
2. Calls `fetchAllPages()` to collect all job records.
3. Calls `insertJobs()` to bulk-insert new records.
4. Updates the `scraper_runs` table row (identified by `runId`) with final stats, timing, logs, and status upon completion or failure.

---

## ScraperManager Class (Public API)

The `ScraperManager` class is the main entry point and is exposed as a singleton. It is imported by all API routes.

### Constructor

```typescript
new ScraperManager()
```

On instantiation:
1. Loads the last run timestamp from `.last_run.json` (or falls back to a DB query).
2. Starts the automatic scheduler.

---

### `getStatus()`

```typescript
public getStatus(): {
  status: ScraperStatus;
  lastRunTime: string | null;
  logCount: number;
  activeRunId: number | null;
  isScheduledRunning: boolean;
  config: {
    scrapeInterval: number;
    maxPages: number;
    pageSize: number;
  };
}
```

Returns the current state and configuration of the scraper. Used by the `/api/scraper` GET endpoint.

---

### `getLiveProgress()`

```typescript
public getLiveProgress(): ScraperProgress & {
  activeRunId: number | null;
  status: ScraperStatus;
  elapsed_ms: number;
}
```

Returns live progress metrics for the currently running scrape cycle. Polled by the `/api/scraper/stream` SSE endpoint every 800ms.

---

### `getLogs()`

```typescript
public getLogs(): string[]
```

Returns the last **150** log lines from the current or most recent scrape cycle. Each line is timestamped in `[HH:MM:SS]` format.

---

### `triggerScrape(isManual?)`

```typescript
public async triggerScrape(isManual?: boolean): Promise<boolean>
```

Starts a new scrape cycle asynchronously.

- Returns `false` immediately if a scrape is already `running`.
- Returns `true` if the cycle was successfully initiated.
- Creates a new row in the `scraper_runs` table and saves it to `activeRunId`.
- On `TokenExpired` mid-cycle, automatically invalidates the token and retries once.

---

### `stopCurrentScrape()`

```typescript
public stopCurrentScrape(): void
```

Aborts the currently active scrape by triggering the `AbortController`. In-flight HTTP requests will be abandoned on the next abort-check point.

---

### `updateConfig(scrapeInterval, maxPages, pageSize)`

```typescript
public updateConfig(scrapeInterval: number, maxPages: number, pageSize: number): boolean
```

Updates the scraper configuration at runtime.

- Sets `process.env` variables immediately.
- Persists the changes to the `.env` file if found on disk.
- Restarts the scheduler with the new interval.
- Returns `true` on success, `false` on failure.

---

### `stopScheduler()`

```typescript
public stopScheduler(): void
```

Stops the automatic scheduling interval. The scraper will no longer trigger automatically until `startScheduler()` is called (e.g., via `updateConfig()`).

---

## Singleton Export

```typescript
declare global { var globalScraperManager: ScraperManager | undefined; }
const scraperManager = globalThis.globalScraperManager || new ScraperManager();
if (process.env.NODE_ENV !== 'production') globalThis.globalScraperManager = scraperManager;

export default scraperManager;
```

In **development mode**, the singleton is stored on `globalThis` to survive Next.js hot-module reloads without creating multiple scheduler instances. In **production**, a fresh instance is created once per process startup.

All three API routes import this singleton:

```typescript
import scraperManager from '@/lib/upwork-job-scraper-manager';
```

---

## Data Flow Diagram

```
User clicks "Trigger Scrape"
          │
          ▼
POST /api/scraper
          │
          ▼
scraperManager.triggerScrape()
          │
          ├─▶ INSERT scraper_runs (status='running')
          │
          ▼
runCycle() [async, non-blocking]
          │
          ├─▶ TokenManager.getToken()
          │         │
          │         ▼
          │   GET https://www.upwork.com/
          │   (browser-impersonated via got-scraping)
          │         │
          │         ▼
          │   Extract visitor_gql_token cookie
          │
          ├─▶ fetchAllPages() [2 concurrent workers]
          │         │
          │         ▼ (per page)
          │   fetchPage() → POST GraphQL API
          │         │
          │         ▼
          │   parseJob() → ScrapedJob[]
          │         │
          │         ▼
          │   onProgress() → updates ScraperProgress
          │
          ├─▶ insertJobs() [batched 200/query]
          │         │
          │         ▼
          │   INSERT INTO jobs ON CONFLICT DO NOTHING
          │
          └─▶ UPDATE scraper_runs SET status, metrics, logs
```

---

## Caveats & Known Limitations

| Topic | Detail |
|---|---|
| **Guest token scope** | The `visitor_gql_token` is a guest-level token without OAuth2 scopes for client metadata (ratings, payment verification, etc.). These fields are stored as `NULL`. |
| **Rate limiting** | Upwork may return HTTP 429. The scraper handles this gracefully per-page but does not implement exponential back-off. Reduce `MAX_PAGES` or increase `SCRAPE_INTERVAL` if rate-limited frequently. |
| **Turbopack warning** | The build emits a single Turbopack warning about "unexpected file in NFT list" caused by `fs.existsSync()` calls in this file. This is a warning, not an error, and does not affect runtime behavior. |
| **Token TTL** | Tokens are cached for 25 minutes. If a cycle runs longer than 25 minutes, a token refresh is attempted mid-cycle. |
| **Duplicate detection** | Deduplication relies on the Upwork job `cipher` (ciphertext ID). If Upwork reassigns a cipher to a different job (extremely rare), the old record will not be updated. |
| **No proxy support** | All requests are made from the host machine's IP. Consider adding proxy rotation if running in a data-center environment where Upwork aggressively rate-limits. |
