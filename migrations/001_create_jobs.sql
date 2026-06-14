-- Migration: 001_create_jobs.sql
-- Creates the jobs table. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS jobs (
    cipher          TEXT        PRIMARY KEY,
    title           TEXT,
    description     TEXT,
    link            TEXT,
    skills          TEXT[],
    published_date  TIMESTAMPTZ,
    job_type        TEXT,
    is_hourly       BOOLEAN,
    hourly_low      NUMERIC,
    hourly_high     NUMERIC,
    budget          NUMERIC,
    duration_weeks  INTEGER,
    contractor_tier INTEGER,
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index to speed up time-based queries
CREATE INDEX IF NOT EXISTS idx_jobs_published_date
    ON jobs (published_date DESC);

-- Index for job_type filtering
CREATE INDEX IF NOT EXISTS idx_jobs_job_type
    ON jobs (job_type);
