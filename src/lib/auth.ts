import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { AppError } from './domain';
export type Session = { role: 'baker' | 'guest'; id: string; exp: number };
const legacyCookieName = 'forno_session';
const cookieNames = { guest: 'forno_guest_session', baker: 'forno_baker_session' };
const sessionLifetime = 30 * 86400_000;
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32 || value.startsWith('CHANGE_ME'))
    throw new AppError(503, 'Die Server-Konfiguration ist noch nicht vollständig.');
  return value;
}
export function equal(a: string, b: string) {
  const hash = (value: string) => createHmac('sha256', secret()).update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
export function encodeSession(role: Session['role'], id: string) {
  const payload = Buffer.from(
    JSON.stringify({ role, id, exp: Date.now() + sessionLifetime }),
  ).toString('base64url');
  return payload + '.' + createHmac('sha256', secret()).update(payload).digest('base64url');
}
export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return ['baker', 'guest'].includes(session.role) &&
      typeof session.id === 'string' &&
      session.id.length > 0 &&
      typeof session.exp === 'number' &&
      Number.isFinite(session.exp) &&
      session.exp > Date.now()
      ? session
      : null;
  } catch {
    return null;
  }
}
// Called only from route handlers: legacy cookies are migrated without logging users out.
export async function getSession(role: Session['role'] = 'guest'): Promise<Session | null> {
  const jar = await cookies();
  const current = jar.get(cookieNames[role])?.value;
  const session = decodeSession(current ?? jar.get(legacyCookieName)?.value);
  if (!session || session.role !== role) return null;
  if (!current || session.exp - Date.now() < sessionLifetime - 86400_000) {
    await setSession(role, session.id);
    return { ...session, exp: Date.now() + sessionLifetime };
  }
  return session;
}
export async function requireSession(role: Session['role']) {
  const session = await getSession(role);
  if (!session) throw new AppError(401, 'Bitte melde dich erneut an.');
  return session;
}
export async function setSession(role: Session['role'], id: string) {
  (await cookies()).set(cookieNames[role], encodeSession(role, id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_ORIGIN?.startsWith('https://') ?? false,
    path: '/',
    maxAge: sessionLifetime / 1000,
  });
}
export async function logout(role: Session['role']) {
  const jar = await cookies();
  jar.delete(cookieNames[role]);
  if (decodeSession(jar.get(legacyCookieName)?.value)?.role === role) jar.delete(legacyCookieName);
}
export function checkOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  if (!configured || request.headers.get('origin') !== new URL(configured).origin)
    throw new AppError(
      403,
      'Diese Anfrage ist nicht erlaubt. Bitte öffne die App über ihre reguläre Adresse.',
    );
}
