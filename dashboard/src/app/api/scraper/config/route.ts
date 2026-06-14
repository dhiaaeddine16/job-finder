import { NextResponse } from 'next/server';
import scraperManager from '@/lib/upwork-job-scraper-manager';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { scrapeInterval, maxPages, pageSize } = body;

    if (
      typeof scrapeInterval !== 'number' ||
      typeof maxPages !== 'number' ||
      typeof pageSize !== 'number'
    ) {
      return NextResponse.json({ error: 'Invalid config types. Must be numbers.' }, { status: 400 });
    }

    const success = scraperManager.updateConfig(scrapeInterval, maxPages, pageSize);
    const status = scraperManager.getStatus();

    return NextResponse.json({
      success,
      status
    });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
