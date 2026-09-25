import { test, expect } from '@playwright/test';
test('Gast und Bäcker: vollständiger Ablauf mit Echtzeit, Zutatenänderung und Undo', async ({
  browser,
  baseURL,
}) => {
  const bakerContext = await browser.newContext({
    viewport: { width: 1024, height: 900 },
    baseURL,
  });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL });
  const baker = await bakerContext.newPage();
  const guest = await guestContext.newPage();
  await baker.goto('/baecker');
  await baker.getByLabel('Bäckerpasswort').fill(process.env.BAKER_PASSWORD!);
  await baker.getByRole('button', { name: 'Ofen öffnen' }).click();
  await baker.getByLabel('Partyname').fill('E2E Pizzaabend');
  await baker.getByRole('button', { name: 'Party erstellen' }).click();
  const code = await baker.getByTestId('party-code').textContent();
  await guest.goto('/');
  await guest.getByLabel('Dein Gruppencode').fill(code!);
  await guest.getByLabel('Wie heißt du?').fill('Anna');
  await guest.getByRole('button', { name: 'Ab zur Pizza-Party' }).click();
  await guest.getByRole('button', { name: 'Tomatensauce', exact: true }).click();
  await guest.getByRole('button', { name: 'Mozzarella', exact: true }).click();
  await guest
    .getByRole('group', { name: 'Position für Mozzarella' })
    .getByRole('button', { name: 'Links ½' })
    .click();
  await guest
    .getByRole('group', { name: 'Menge für Mozzarella' })
    .getByRole('button', { name: 'viel' })
    .click();
  await guest.getByRole('button', { name: 'Champignons', exact: true }).click();
  await guest
    .getByRole('group', { name: 'Position für Champignons' })
    .getByRole('button', { name: 'Rechts ½' })
    .click();
  await guest.getByRole('button', { name: 'Pizza prüfen' }).click();
  await expect(guest.getByText('Mozzarella (viel)', { exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Pizza bestellen', exact: true }).click();
  const order = baker.getByTestId('order-1');
  await expect(order.getByText('Anna')).toBeVisible();
  await expect(order.getByText('Linke Hälfte')).toBeVisible();
  await expect(order.getByText('Rechte Hälfte')).toBeVisible();
  await order.getByRole('button', { name: 'Fertig', exact: true }).click();
  await expect(guest.getByText('Pizza ist fertig – ab zum Ofen!')).toBeVisible();
  await guestContext.setOffline(true);
  await baker.locator('summary').click();
  await baker.getByRole('button', { name: 'Wieder öffnen' }).click();
  await guestContext.setOffline(false);
  await expect(guest.getByTestId('order-1').getByText('Offen', { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(guest.locator('.ready-banner')).toHaveCount(0);
  await guest.reload();
  await guest.getByRole('button', { name: /Meine Pizzen/ }).click();
  await expect(guest.getByTestId('order-1')).toBeVisible();
  await guest.getByRole('button', { name: 'Noch eine Pizza bestellen' }).click();
  // Commit the order on the server, but lose its response on the way to the guest.
  await guest.route(
    '**/api/orders',
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  await guest.getByRole('button', { name: 'Tomatensauce', exact: true }).click();
  await guest.getByRole('button', { name: 'Pizza prüfen' }).click();
  await guest.getByRole('button', { name: 'Pizza bestellen', exact: true }).click();
  await expect(guest.locator('.error-box')).toContainText('Keine Verbindung');
  // Disable SSE after reload: the periodic snapshot fallback must still synchronize.
  await guest.route('**/api/events*', (route) => route.abort());
  await guest.reload();
  await guest.getByRole('button', { name: 'Bestellung prüfen', exact: true }).click();
  await expect(guest.getByTestId('order-2')).toBeVisible();
  await expect(baker.getByTestId('order-2')).toBeVisible();
  await expect(baker.getByTestId('order-3')).toHaveCount(0);
  await guest.getByRole('button', { name: 'Noch eine Pizza bestellen' }).click();
  await baker.getByRole('button', { name: 'Zutaten verwalten' }).click();
  await baker.getByRole('switch', { name: 'Salami', exact: true }).click();
  await expect(baker.getByRole('switch', { name: 'Salami', exact: true })).not.toBeChecked();
  await expect(guest.getByRole('button', { name: 'Salami Heute aus' })).toBeDisabled({
    timeout: 12000,
  });
  await expect(guest.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await guest.screenshot({ path: 'test-results/guest-mobile.png', fullPage: true });
  await baker.getByRole('button', { name: /Am Ofen/ }).click();
  await baker.screenshot({ path: 'test-results/baker-tablet.png', fullPage: true });
  await baker.getByRole('button', { name: 'Party beenden', exact: true }).click();
  await baker.getByRole('button', { name: 'Jetzt beenden' }).click();
  await expect(guest.getByText(/Der Ofen macht Pause/)).toBeVisible({ timeout: 12000 });
  await expect(guest.getByRole('button', { name: 'Pizza prüfen' })).toBeDisabled();
  await bakerContext.close();
  await guestContext.close();
});
test('Administrative Endpunkte sind geschützt und fremde Origins werden abgewiesen', async ({
  request,
}) => {
  const parties = await request.get('/api/parties');
  expect(parties.status()).toBe(401);
  const forged = await request.post('/api/login', {
    headers: { origin: 'https://example.invalid' },
    data: { password: process.env.BAKER_PASSWORD },
  });
  expect(forged.status()).toBe(403);
});

test('Startseite bleibt auf Smartphone und Desktop ohne horizontalen Überlauf bedienbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Du bist eingeladen.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.getByRole('button', { name: 'Ab zur Pizza-Party' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Ab zur Pizza-Party' })).toBeVisible();
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
});
