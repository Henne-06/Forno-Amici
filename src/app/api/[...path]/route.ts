import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { AppError } from '@/lib/domain';
import { checkOrigin, equal, getSession, logout, requireSession, setSession } from '@/lib/auth';
import {
  createOrder,
  createParty,
  endParty,
  joinParty,
  rateLimit,
  setAvailability,
  setOrderStatus,
  snapshot,
} from '@/lib/service';
import { db } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 16000) throw new AppError(413, 'Die Anfrage ist zu groß.');
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'Die Anfrage konnte nicht gelesen werden.');
  }
}
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const route = path.join('/');
    if (request.method === 'POST') checkOrigin(request);
    const ip = request.headers.get('x-real-ip') ?? 'local';
    if (route === 'session' && request.method === 'GET') {
      const role = z
        .enum(['guest', 'baker'])
        .parse(new URL(request.url).searchParams.get('role') ?? 'guest');
      const session = await getSession(role);
      if (!session) return NextResponse.json({ role: null });
      if (session.role === 'baker') return NextResponse.json({ role: 'baker' });
      const guest = await db.guest.findUnique({
        where: { id: session.id },
        select: { name: true, partyId: true, id: true },
      });
      return NextResponse.json(guest ? { role: 'guest', guest } : { role: null });
    }
    if (route === 'join' && request.method === 'POST') {
      await rateLimit('join:' + ip, 30);
      const previous = await getSession('guest');
      const guest = await joinParty(await body(request), previous?.id);
      await setSession('guest', guest.id);
      return NextResponse.json({ partyId: guest.partyId });
    }
    if (route === 'login' && request.method === 'POST') {
      await rateLimit('login:' + ip, 8);
      const { password } = z.object({ password: z.string().max(200) }).parse(await body(request));
      const configured = process.env.BAKER_PASSWORD;
      if (!configured || configured.length < 16 || configured.startsWith('CHANGE_ME'))
        throw new AppError(503, 'Bitte konfiguriere zuerst ein sicheres Bäckerpasswort.');
      if (!equal(password, configured))
        throw new AppError(401, 'Das Passwort stimmt leider nicht.');
      await setSession('baker', 'host');
      return NextResponse.json({ ok: true });
    }
    if (route === 'logout' && request.method === 'POST') {
      const { role } = z.object({ role: z.enum(['guest', 'baker']) }).parse(await body(request));
      await logout(role);
      return NextResponse.json({ ok: true });
    }
    if (route === 'guest' && request.method === 'GET') {
      const session = await requireSession('guest');
      const guest = await db.guest.findUnique({ where: { id: session.id } });
      if (!guest) throw new AppError(401, 'Bitte tritt der Party erneut bei.');
      return NextResponse.json(await snapshot(guest.partyId, guest.id));
    }
    if (route === 'orders' && request.method === 'POST') {
      const session = await requireSession('guest');
      await rateLimit('order:' + session.id, 15);
      return NextResponse.json(await createOrder(session.id, await body(request)));
    }
    await requireSession('baker');
    if (route === 'parties') {
      if (request.method === 'GET')
        return NextResponse.json(
          await db.pizzaParty.findMany({
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, code: true, active: true, revision: true },
          }),
        );
      await rateLimit('party:' + ip, 10);
      return NextResponse.json(await createParty(await body(request)));
    }
    if (path[0] === 'parties' && path[1]) {
      const partyId = path[1];
      if (path.length === 2 && request.method === 'GET')
        return NextResponse.json(await snapshot(partyId));
      if (request.method === 'POST') {
        if (path[2] === 'end' && path.length === 3) await endParty(partyId);
        else if (path[2] === 'ingredients' && path[3] && path.length === 4) {
          const { available } = z.object({ available: z.boolean() }).parse(await body(request));
          await setAvailability(partyId, path[3], available);
        } else if (path[2] === 'orders' && path[3] && path.length === 4) {
          const { status } = z
            .object({ status: z.enum(['OPEN', 'DONE']) })
            .parse(await body(request));
          await setOrderStatus(partyId, path[3], status);
        } else throw new AppError(404, 'Seite nicht gefunden.');
        return NextResponse.json({ ok: true });
      }
    }
    throw new AppError(404, 'Seite nicht gefunden.');
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Bitte prüfe deine Eingaben.' },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('API request failed', error);
    return NextResponse.json(
      { error: 'Das hat gerade nicht geklappt. Bitte versuche es erneut.' },
      { status: 500 },
    );
  }
}
async function route(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const response = await handle(request, context);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Cookie');
  return response;
}
export { route as GET, route as POST };
