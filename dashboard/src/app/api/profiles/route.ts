import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');

  try {
    if (idParam) {
      const id = parseInt(idParam, 10);
      if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      const res = await pool.query('SELECT * FROM profiles WHERE id = $1', [id]);
      if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ profile: res.rows[0] });
    }

    // list with simple pagination
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const res = await pool.query('SELECT * FROM profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return NextResponse.json({ profiles: res.rows, pagination: { limit, offset } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      full_name,
      profile_title,
      profile_description,
      projects = [],
      skills = [],
      jobs = [],
      education = [],
      certifications = [],
      github_profile,
    } = body;

    if (!full_name) return NextResponse.json({ error: 'full_name is required' }, { status: 400 });

    const res = await pool.query(
      `INSERT INTO profiles (full_name, profile_title, profile_description, projects, skills, jobs, education, certifications, github_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [full_name, profile_title, profile_description, JSON.stringify(projects), skills, JSON.stringify(jobs), JSON.stringify(education), JSON.stringify(certifications), github_profile]
    );

    return NextResponse.json({ profile: res.rows[0] }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Build dynamic SET clause
    const allowed = new Set(['full_name','profile_title','profile_description','projects','skills','jobs','education','certifications','github_profile']);
    const keys = Object.keys(body).filter(k => allowed.has(k) && k !== 'id');
    if (keys.length === 0) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 });

    const sets = keys.map((k, i) => `${k} = $${i+2}`);
    const values = keys.map(k => {
      if (['projects','jobs','education','certifications'].includes(k)) return JSON.stringify((body as any)[k]);
      return (body as any)[k];
    });

    const query = `UPDATE profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const res = await pool.query(query, [id, ...values]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ profile: res.rows[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    if (!idParam) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const id = parseInt(idParam, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const res = await pool.query('DELETE FROM profiles WHERE id = $1 RETURNING *', [id]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deleted: res.rows[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
