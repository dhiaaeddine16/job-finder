import { NextResponse } from 'next/server';
import scraperManager from '@/lib/upwork-job-scraper-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (data: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Send first event immediately
      send(scraperManager.getLiveProgress());

      const intervalId = setInterval(() => {
        const progress = scraperManager.getLiveProgress();
        send(progress);

        // Stop streaming once the scraper is no longer running
        if (progress.status !== 'running' && !closed) {
          clearInterval(intervalId);
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }, 800);

      // Safety cleanup after 10 minutes max
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }, 10 * 60 * 1000);

      // Cleanup if client disconnects
      return () => {
        closed = true;
        clearInterval(intervalId);
        clearTimeout(timeoutId);
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
