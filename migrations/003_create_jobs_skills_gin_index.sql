-- Migration: 003_create_jobs_skills_gin_index.sql
-- Add a GIN index on the jobs.skills array to speed up containment queries

-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction. If your migration runner wraps migrations in a transaction,
-- run the following statement manually or adapt to your migration tooling.

CREATE INDEX IF NOT EXISTS idx_jobs_skills_gin ON jobs USING GIN (skills);
