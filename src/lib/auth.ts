import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { AppError } from './domain';
export type Session = { role: 'baker' | 'guest'; id: string; exp: number };
const cookieName = 'forno_session';
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
    JSON.stringify({ role, id, exp: Date.now() + 30 * 86400_000 }),
  ).toString('base64url');
  return payload + '.' + createHmac('sha256', secret()).update(payload).digest('base64url');
}
export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return ['baker', 'guest'].includes(session.role) &&
      typeof session.id === 'string' &&
      session.exp > Date.now()
      ? session
      : null;
  } catch {
    return null;
  }
}
export async function requireSession(role?: Session['role']) {
  const session = await getSession();
  if (!session || (role && session.role !== role))
    throw new AppError(401, 'Bitte melde dich erneut an.');
  return session;
}
export async function setSession(role: Session['role'], id: string) {
  (await cookies()).set(cookieName, encodeSession(role, id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_ORIGIN?.startsWith('https://') ?? false,
    path: '/',
    maxAge: 30 * 86400,
  });
}
export async function logout() {
  (await cookies()).delete(cookieName);
}
export function checkOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  if (!configured || request.headers.get('origin') !== new URL(configured).origin)
    throw new AppError(
      403,
      'Diese Anfrage ist nicht erlaubt. Bitte öffne die App über ihre reguläre Adresse.',
    );
}
