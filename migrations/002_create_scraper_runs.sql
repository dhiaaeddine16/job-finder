-- Migration: 002_create_scraper_runs.sql
-- Creates the scraper_runs table for storing run history, metrics, and logs.

CREATE TABLE IF NOT EXISTS scraper_runs (
    id              SERIAL PRIMARY KEY,
    start_time      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    end_time        TIMESTAMPTZ,
    status          VARCHAR(50)     NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'error'
    pages_success   INT             NOT NULL DEFAULT 0,
    pages_failed    INT             NOT NULL DEFAULT 0,
    jobs_fetched    INT             NOT NULL DEFAULT 0,
    jobs_inserted   INT             NOT NULL DEFAULT 0,
    duration_seconds NUMERIC(10,2),
    details         JSONB,          -- Array of page-level stats
    logs            TEXT            -- Full log buffer for this run
);

-- Index for listing recent runs fast
CREATE INDEX IF NOT EXISTS idx_scraper_runs_start_time
    ON scraper_runs (start_time DESC);
