import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

function legacyToken(role: 'guest' | 'baker', id: string) {
  const payload = Buffer.from(JSON.stringify({ role, id, exp: Date.now() + 3600_000 })).toString(
    'base64url',
  );
  return `${payload}.${createHmac('sha256', process.env.SESSION_SECRET!).update(payload).digest('base64url')}`;
}

test('Rollenwechsel, erneuter Beitritt und Browser-Neustart erhalten die eigenen Pizzen', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = baseURL!;
  const post = (path: string, data: unknown) =>
    context.request.post('/api/' + path, { headers: { origin }, data });
  expect((await post('login', { password: process.env.BAKER_PASSWORD })).ok()).toBeTruthy();
  const party = await (await post('parties', { name: 'Sitzungen bleiben erhalten' })).json();
  expect((await post('join', { code: party.code, name: 'Alex' })).ok()).toBeTruthy();
  const original = await (await context.request.get('/api/session')).json();
  const order = await post('orders', { idempotencyKey: crypto.randomUUID(), toppings: [] });
  expect(order.ok()).toBeTruthy();

  await page.goto('/gast');
  await expect(page.getByTestId('order-1')).toBeVisible();
  await page.getByRole('link', { name: 'Am Pizzaofen' }).click();
  await expect(page.getByRole('heading', { name: 'Deine Partys' })).toBeVisible();
  await expect(page.getByLabel('Bäckerpasswort')).toHaveCount(0);
  await page.getByRole('link', { name: 'Für Gäste' }).click();
  await page.getByRole('button', { name: 'Zurück zu deiner Party' }).click();
  await expect(page.getByTestId('order-1')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('order-1')).toBeVisible();

  expect((await post('join', { code: party.code, name: 'Alex' })).ok()).toBeTruthy();
  const resumed = await (await context.request.get('/api/session')).json();
  expect(resumed.guest.id).toBe(original.guest.id);
  expect((await (await context.request.get('/api/guest')).json()).orders).toHaveLength(1);
  const cookies = await context.cookies();
  for (const name of ['forno_guest_session', 'forno_baker_session']) {
    const cookie = cookies.find((c) => c.name === name)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 28 * 86400);
  }

  const reopened = await browser.newContext({
    baseURL,
    storageState: await context.storageState(),
  });
  const reopenedPage = await reopened.newPage();
  await reopenedPage.goto('/gast');
  await expect(reopenedPage.getByTestId('order-1')).toBeVisible();
  await reopenedPage.goto('/baecker');
  await reopenedPage.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await reopenedPage.goto('/gast');
  await expect(reopenedPage.getByTestId('order-1')).toBeVisible();
  await reopened.close();

  expect((await post('logout', { role: 'guest' })).ok()).toBeTruthy();
  expect((await context.request.get('/api/parties')).ok()).toBeTruthy();
  expect((await context.request.get('/api/guest')).status()).toBe(401);
  // A name alone must never grant access to another guest's orders.
  expect((await post('join', { code: party.code, name: 'Alex' })).ok()).toBeTruthy();
  expect((await (await context.request.get('/api/guest')).json()).orders).toHaveLength(0);
  await post(`parties/${party.id}/end`, {});
});

test('Bestehende Cookies werden migriert und aktive Sitzungen verlängert', async ({
  context,
  baseURL,
}) => {
  const origin = baseURL!;
  const post = (path: string, data: unknown) =>
    context.request.post('/api/' + path, { headers: { origin }, data });
  await context.addCookies([
    {
      name: 'forno_session',
      value: legacyToken('baker', 'host'),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  expect((await context.request.get('/api/session?role=baker')).ok()).toBeTruthy();
  const party = await (await post('parties', { name: 'Cookie-Migration' })).json();
  await post('join', { code: party.code, name: 'Mia' });
  const guest = (await (await context.request.get('/api/session')).json()).guest;
  await post('orders', { idempotencyKey: crypto.randomUUID(), toppings: [] });
  await context.clearCookies({ name: 'forno_guest_session' });
  await context.addCookies([
    {
      name: 'forno_session',
      value: legacyToken('guest', guest.id),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const response = await context.request.get('/api/guest');
  expect((await response.json()).orders).toHaveLength(1);
  expect(response.headers()['cache-control']).toContain('no-store');
  const migrated = (await context.cookies()).find((c) => c.name === 'forno_guest_session')!;
  expect(migrated.expires).toBeGreaterThan(Date.now() / 1000 + 28 * 86400);
  await context.addCookies([{ ...migrated, value: legacyToken('guest', guest.id) }]);
  await context.request.get('/api/guest');
  const renewed = (await context.cookies()).find((c) => c.name === 'forno_guest_session')!;
  expect(renewed.value).not.toBe(legacyToken('guest', guest.id));
  const payload = JSON.parse(Buffer.from(renewed.value.split('.')[0], 'base64url').toString());
  expect(payload.exp).toBeGreaterThan(Date.now() + 28 * 86400_000);
  await post('logout', { role: 'guest' });
  expect((await context.request.get('/api/guest')).status()).toBe(401);
  expect((await context.request.get('/api/parties')).ok()).toBeTruthy();
  await post(`parties/${party.id}/end`, {});
});
