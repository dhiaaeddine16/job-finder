import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const totalJobsQuery = 'SELECT COUNT(*) FROM jobs';
    const jobTypesQuery = `
      SELECT job_type, COUNT(*) as count 
      FROM jobs 
      GROUP BY job_type
    `;
    const avgBudgetQuery = `
      SELECT AVG(budget) as avg_budget 
      FROM jobs 
      WHERE job_type = 'FIXED' AND budget IS NOT NULL
    `;
    const avgHourlyQuery = `
      SELECT AVG(hourly_low) as avg_low, AVG(hourly_high) as avg_high 
      FROM jobs 
      WHERE job_type = 'HOURLY'
    `;
    const contractorTiersQuery = `
      SELECT contractor_tier, COUNT(*) as count 
      FROM jobs 
      WHERE contractor_tier IS NOT NULL
      GROUP BY contractor_tier 
      ORDER BY contractor_tier
    `;
    const topSkillsQuery = `
      SELECT unnest(skills) as skill, COUNT(*) as count 
      FROM jobs 
      GROUP BY skill 
      ORDER BY count DESC 
      LIMIT 15
    `;
    const timelineQuery = `
      SELECT
        TO_CHAR(DATE_TRUNC('hour', published_date), 'YYYY-MM-DD"T"HH24:00') AS hour,
        COUNT(*) AS count,
        SUM(CASE WHEN job_type = 'HOURLY' THEN 1 ELSE 0 END) AS hourly_count,
        SUM(CASE WHEN job_type = 'FIXED' THEN 1 ELSE 0 END) AS fixed_count,
        SUM(CASE WHEN contractor_tier = 1 THEN 1 ELSE 0 END) AS entry_count,
        SUM(CASE WHEN contractor_tier = 2 THEN 1 ELSE 0 END) AS intermediate_count,
        SUM(CASE WHEN contractor_tier = 3 THEN 1 ELSE 0 END) AS expert_count
      FROM jobs
      WHERE published_date >= NOW() - INTERVAL '7 days'
        AND published_date IS NOT NULL
      GROUP BY hour
      ORDER BY hour ASC
    `;


    const [
      totalRes,
      typesRes,
      avgBudgetRes,
      avgHourlyRes,
      tiersRes,
      skillsRes,
      timelineRes
    ] = await Promise.all([
      pool.query(totalJobsQuery),
      pool.query(jobTypesQuery),
      pool.query(avgBudgetQuery),
      pool.query(avgHourlyQuery),
      pool.query(contractorTiersQuery),
      pool.query(topSkillsQuery),
      pool.query(timelineQuery)
    ]);

    const total = parseInt(totalRes.rows[0].count, 10);
    
    // Parse job types
    let hourlyCount = 0;
    let fixedCount = 0;
    typesRes.rows.forEach((row: { job_type: string; count: string }) => {
      if (row.job_type === 'HOURLY') hourlyCount = parseInt(row.count, 10);
      if (row.job_type === 'FIXED') fixedCount = parseInt(row.count, 10);
    });

    const avgBudget = Math.round(parseFloat(avgBudgetRes.rows[0].avg_budget || '0'));
    const avgHourlyLow = Math.round(parseFloat(avgHourlyRes.rows[0].avg_low || '0') * 10) / 10;
    const avgHourlyHigh = Math.round(parseFloat(avgHourlyRes.rows[0].avg_high || '0') * 10) / 10;

    // Parse contractor tiers
    const tiers = { entry: 0, intermediate: 0, expert: 0 };
    tiersRes.rows.forEach((row: { contractor_tier: string; count: string }) => {
      const tier = parseInt(row.contractor_tier, 10);
      const count = parseInt(row.count, 10);
      if (tier === 1) tiers.entry = count;
      if (tier === 2) tiers.intermediate = count;
      if (tier === 3) tiers.expert = count;
    });

    // Parse top skills
    const topSkills = skillsRes.rows.map((row: { skill: string; count: string }) => ({
      name: row.skill,
      count: parseInt(row.count, 10)
    }));

    // Parse hourly timeline data
    const postingTimeline = timelineRes.rows.map((row: any) => ({
      date: row.hour,   // ISO string like "2026-06-13T14:00"
      count: parseInt(row.count, 10),
      hourly_count: parseInt(row.hourly_count || '0', 10),
      fixed_count: parseInt(row.fixed_count || '0', 10),
      entry_count: parseInt(row.entry_count || '0', 10),
      intermediate_count: parseInt(row.intermediate_count || '0', 10),
      expert_count: parseInt(row.expert_count || '0', 10)
    }));

    return NextResponse.json({
      total_jobs: total,
      job_types: {
        hourly: hourlyCount,
        fixed: fixedCount,
      },
      averages: {
        fixed_budget: avgBudget,
        hourly_low: avgHourlyLow,
        hourly_high: avgHourlyHigh
      },
      contractor_tiers: tiers,
      top_skills: topSkills,
      posting_timeline: postingTimeline
    });
  } catch (error) {
    const err = error as Error;
    console.error('Database stats query error:', err);
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}
