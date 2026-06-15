import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

  try {
    // Build pattern for ILIKE search
    const pattern = q ? `%${q}%` : '%';

    const query = `
      SELECT skill AS name, COUNT(*)::int AS count
      FROM (
        SELECT unnest(skills) AS skill
        FROM jobs
      ) s
      WHERE skill ILIKE $1
      GROUP BY skill
      ORDER BY COUNT(*) DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT unnest(skills) AS skill
        FROM jobs
      ) s
      WHERE skill ILIKE $1
    `;

    const [rowsResult, totalResult] = await Promise.all([
      pool.query(query, [pattern, limit, offset]),
      pool.query(countQuery, [pattern])
    ]);

    const skills = rowsResult.rows.map((r: any) => ({ name: r.name, count: r.count }));
    const total = totalResult.rows[0]?.total ?? 0;

    return NextResponse.json({ skills, total });
  } catch (err) {
    console.error('Error fetching skills:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
