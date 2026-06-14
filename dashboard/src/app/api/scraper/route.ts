import { NextRequest, NextResponse } from 'next/server';
import scraperManager from '@/lib/upwork-job-scraper-manager';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const status = scraperManager.getStatus();
    const logs = scraperManager.getLogs();

    const runIdParam = req.nextUrl.searchParams.get('run_id');

    // If a specific run_id is requested, return just that run's details
    if (runIdParam) {
      const runId = parseInt(runIdParam, 10);
      if (isNaN(runId)) {
        return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 });
      }
      const res = await pool.query(
        `SELECT id, start_time, end_time, status, pages_success, pages_failed,
                jobs_fetched, jobs_inserted, duration_seconds, details, logs
         FROM scraper_runs WHERE id = $1`,
        [runId]
      );
      if (res.rows.length === 0) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      }
      return NextResponse.json({ run: res.rows[0] });
    }

    // Get pagination parameters
    const limitParam = req.nextUrl.searchParams.get('limit');
    const offsetParam = req.nextUrl.searchParams.get('offset');
    const limit = limitParam ? parseInt(limitParam, 10) : 10;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    // Get global stats (total runs, successful, failed)
    const statsQuery = `
      SELECT
        COUNT(*)::int as total,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0)::int as success,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0)::int as failed
      FROM scraper_runs
    `;
    
    const runsQuery = `
      SELECT id, start_time, end_time, status, pages_success, pages_failed,
             jobs_fetched, jobs_inserted, duration_seconds, details
      FROM scraper_runs
      ORDER BY start_time DESC
      LIMIT $1 OFFSET $2
    `;

    const [statsRes, runsRes] = await Promise.all([
      pool.query(statsQuery),
      pool.query(runsQuery, [limit, offset])
    ]);

    const globalStats = statsRes.rows[0] || { total: 0, success: 0, failed: 0 };

    return NextResponse.json({
      status,
      logs,
      runs: runsRes.rows,
      pagination: {
        total: globalStats.total,
        limit,
        offset
      },
      global_stats: {
        total: globalStats.total,
        success: globalStats.success,
        failed: globalStats.failed
      }
    });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const triggered = await scraperManager.triggerScrape();
    const status = scraperManager.getStatus();

    return NextResponse.json({
      success: triggered,
      status,
    });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
