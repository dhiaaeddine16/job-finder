import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const searchScope = searchParams.get('search_scope') || 'both';
  const searchMatch = searchParams.get('search_match') || 'partial'; // 'partial' | 'strict'
  const jobType = searchParams.get('job_type') || '';
  const contractorTier = searchParams.get('contractor_tier') || '';
  // Support multiple skills via repeated `skills` params or comma-separated `skills`
  const rawSkills = searchParams.getAll('skills');
  // Fallback to single 'skill' param for backward compatibility
  const singleSkill = searchParams.get('skill') || '';
  let skills: string[] = [];
  if (rawSkills.length > 0) {
    // split comma-separated values
    skills = rawSkills.flatMap(s => s.split(',').map(x => x.trim()).filter(Boolean));
  } else if (singleSkill) {
    skills = [singleSkill];
  }
  const minBudget = searchParams.get('min_budget') ? parseFloat(searchParams.get('min_budget')!) : null;
  const maxBudget = searchParams.get('max_budget') ? parseFloat(searchParams.get('max_budget')!) : null;
  const duration = searchParams.get('duration') || '';
  const sortBy = searchParams.get('sort_by') || 'newest';

  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

  try {
    let query = `SELECT cipher, title, description, link, skills, published_date, job_type, is_hourly, hourly_low, hourly_high, budget, duration_weeks, contractor_tier FROM jobs`;
    let countQuery = `SELECT COUNT(*) FROM jobs`;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      // Escape special regex chars for strict word-boundary search
      const escapedForRegex = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const strictPattern = `\\y${escapedForRegex}\\y`;
      const partialPattern = `%${search}%`;

      if (searchMatch === 'strict') {
        // PostgreSQL case-insensitive regex with word boundaries (\y)
        if (searchScope === 'title') {
          conditions.push(`title ~* $${paramIndex}`);
        } else if (searchScope === 'description') {
          conditions.push(`description ~* $${paramIndex}`);
        } else {
          conditions.push(`(title ~* $${paramIndex} OR description ~* $${paramIndex})`);
        }
        values.push(strictPattern);
      } else {
        // Partial match — default ILIKE '%term%'
        if (searchScope === 'title') {
          conditions.push(`title ILIKE $${paramIndex}`);
        } else if (searchScope === 'description') {
          conditions.push(`description ILIKE $${paramIndex}`);
        } else {
          conditions.push(`(title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
        }
        values.push(partialPattern);
      }
      paramIndex++;
    }

    if (jobType) {
      conditions.push(`job_type = $${paramIndex}`);
      values.push(jobType);
      paramIndex++;
    }

    if (contractorTier) {
      conditions.push(`contractor_tier = $${paramIndex}`);
      values.push(parseInt(contractorTier, 10));
      paramIndex++;
    }

    // Support multiple skills: match any selected skill (OR semantics)
    if (skills.length > 0) {
      // Use Postgres array overlap operator (&&) so jobs.skills overlaps the provided array (any match)
      conditions.push(`skills && $${paramIndex}`);
      values.push(skills);
      paramIndex++;
    }

    if (minBudget !== null) {
      conditions.push(`(
        (job_type = 'FIXED' AND budget >= $${paramIndex}) OR 
        (job_type = 'HOURLY' AND hourly_low >= $${paramIndex})
      )`);
      values.push(minBudget);
      paramIndex++;
    }

    if (maxBudget !== null) {
      conditions.push(`(
        (job_type = 'FIXED' AND budget <= $${paramIndex}) OR 
        (job_type = 'HOURLY' AND hourly_high <= $${paramIndex})
      )`);
      values.push(maxBudget);
      paramIndex++;
    }

    if (duration) {
      if (duration === 'less_than_1m') {
        conditions.push(`duration_weeks <= 4`);
      } else if (duration === '1_to_3m') {
        conditions.push(`duration_weeks > 4 AND duration_weeks <= 12`);
      } else if (duration === 'more_than_3m') {
        conditions.push(`duration_weeks > 12`);
      }
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    // Determine sorting
    let orderBy = 'published_date DESC';
    if (sortBy === 'highest_budget') {
      orderBy = 'COALESCE(budget, hourly_high, 0) DESC, published_date DESC';
    } else if (sortBy === 'highest_hourly') {
      orderBy = 'hourly_high DESC NULLS LAST, published_date DESC';
    } else if (sortBy === 'oldest') {
      orderBy = 'published_date ASC';
    }

    query += ` ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const queryValues = [...values, limit, offset];

    const [jobsResult, countResult] = await Promise.all([
      pool.query(query, queryValues),
      pool.query(countQuery, values)
    ]);

    const jobs = jobsResult.rows;
    const total = parseInt(countResult.rows[0].count, 10);

    return NextResponse.json({
      jobs,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total
      }
    });
  } catch (error) {
    const err = error as Error;
    console.error('Database query error:', err);
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}
