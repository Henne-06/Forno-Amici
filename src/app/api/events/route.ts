import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/domain';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    let partyId = new URL(request.url).searchParams.get('party');
    if (session.role === 'guest') {
      const guest = await db.guest.findUnique({ where: { id: session.id } });
      if (!guest) throw new AppError(401, 'Session abgelaufen.');
      partyId = guest.partyId;
    }
    if (
      !partyId ||
      !(await db.pizzaParty.findUnique({ where: { id: partyId }, select: { id: true } }))
    )
      throw new AppError(404, 'Party nicht gefunden.');
    const id = partyId;
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        let stopped = false;
        let revision = -1;
        let ticks = 0;
        let timer: ReturnType<typeof setTimeout>;
        cleanup = () => {
          stopped = true;
          clearTimeout(timer);
          request.signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          try {
            controller.close();
          } catch {}
        };
        request.signal.addEventListener('abort', abort, { once: true });
        async function tick() {
          if (stopped) return;
          try {
            if (session.exp <= Date.now() || ticks++ > 1200) {
              abort();
              return;
            }
            const party = await db.pizzaParty.findUnique({
              where: { id },
              select: { revision: true },
            });
            if (stopped) return;
            if (!party) {
              abort();
              return;
            }
            if (party.revision !== revision) {
              revision = party.revision;
              controller.enqueue(encoder.encode(`event: update\ndata: ${revision}\n\n`));
            } else controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            abort();
            return;
          }
          if (!stopped) timer = setTimeout(tick, 1500);
        }
        if (request.signal.aborted) abort();
        else void tick();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return Response.json(
      { error: 'Live-Verbindung nicht verfügbar.' },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
