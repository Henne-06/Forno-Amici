import 'dotenv/config';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import {
  createParty,
  joinParty,
  createOrder,
  setAvailability,
  setOrderStatus,
  endParty,
  snapshot,
} from '../src/lib/service';
import { seed } from '../prisma/seed';
if (!process.env.DATABASE_URL?.includes('forno_test'))
  throw new Error('Integrationstests nur mit separater forno_test-Datenbank ausführen.');
const partyIds: string[] = [];
before(seed);
after(async () => {
  await db.pizzaParty.deleteMany({ where: { id: { in: partyIds } } });
  await db.$disconnect();
});
async function fixture() {
  const party = await createParty({ name: 'Integration ' + randomUUID() });
  partyIds.push(party.id);
  const guest = await joinParty({ code: party.code, name: 'Ada' });
  return { party, guest };
}
const request = () => ({
  idempotencyKey: randomUUID(),
  toppings: [
    { ingredientId: 'cheese-0', position: 'LEFT', amount: 'HIGH' },
    { ingredientId: 'vegetables-0', position: 'RIGHT', amount: null },
    { ingredientId: 'sauce-0', position: 'WHOLE', amount: null },
  ],
});
test('Partybeitritt mit gültigem, falschem und beendetem Code', async () => {
  const { party, guest } = await fixture();
  assert.equal(guest.partyId, party.id);
  await assert.rejects(joinParty({ code: 'FORNO-222222', name: 'Ada' }), /Gruppencode/);
  await endParty(party.id);
  await assert.rejects(joinParty({ code: party.code, name: 'Ben' }), /beendet/);
});
test('Bestellung speichert Hälften, Käsemengen und Snapshot; DONE und Undo funktionieren', async () => {
  const { party, guest } = await fixture();
  const order = await createOrder(guest.id, request());
  assert.equal(order.number, 1);
  assert.equal(order.status, 'OPEN');
  assert.equal(order.toppings.find((t) => t.ingredientId === 'cheese-0')?.amount, 'HIGH');
  assert.equal(order.toppings.find((t) => t.ingredientId === 'cheese-0')?.position, 'LEFT');
  assert.equal(order.toppings.find((t) => t.ingredientId === 'vegetables-0')?.position, 'RIGHT');
  assert.equal(order.toppings.find((t) => t.ingredientId === 'sauce-0')?.position, 'WHOLE');
  await setAvailability(party.id, 'cheese-0', false);
  assert.deepEqual(
    (await snapshot(party.id)).orders[0].toppings.map((t) => t.name).sort(),
    order.toppings.map((t) => t.name).sort(),
  );
  await db.ingredient.update({ where: { id: 'cheese-0' }, data: { name: 'Umbenannt' } });
  assert.equal(
    (await snapshot(party.id)).orders[0].toppings.find((t) => t.ingredientId === 'cheese-0')?.name,
    'Mozzarella',
  );
  await seed();
  await setOrderStatus(party.id, order.id, 'DONE');
  assert.equal((await snapshot(party.id)).orders[0].status, 'DONE');
  await setOrderStatus(party.id, order.id, 'OPEN');
  assert.equal((await snapshot(party.id)).orders[0].status, 'OPEN');
});
test('Deaktivierte Zutaten, fehlende Käsemengen, doppelte Beläge und beendete Partys werden abgewiesen', async () => {
  const { party, guest } = await fixture();
  await assert.rejects(
    createOrder(guest.id, {
      ...request(),
      toppings: [{ ingredientId: 'cheese-0', position: 'WHOLE', amount: null }],
    }),
    /Menge/,
  );
  const req = request();
  await assert.rejects(
    createOrder(guest.id, { ...req, toppings: [req.toppings[0], req.toppings[0]] }),
  );
  await setAvailability(party.id, 'cheese-0', false);
  await assert.rejects(createOrder(guest.id, request()), /nicht mehr verfügbar/);
  await setAvailability(party.id, 'cheese-0', true);
  await endParty(party.id);
  await assert.rejects(createOrder(guest.id, request()), /beendet/);
  assert.equal((await snapshot(party.id)).orders.length, 0);
});
test('Gleichzeitige Gäste erhalten fortlaufende, eindeutige Bestellnummern', async () => {
  const { party } = await fixture();
  const guests = await Promise.all(
    Array.from({ length: 12 }, (_, i) => joinParty({ code: party.code, name: `Gast ${i}` })),
  );
  const orders = await Promise.all(guests.map((g) => createOrder(g.id, request())));
  assert.deepEqual(
    orders.map((o) => o.number).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  const state = await snapshot(party.id);
  assert.deepEqual(
    state.orders.map((o) => o.number),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
});
test('Parallele Wiederholungen und Retry nach Partyende erstellen nur eine Pizza', async () => {
  const { party, guest } = await fixture();
  const req = request();
  const results = await Promise.all(Array.from({ length: 6 }, () => createOrder(guest.id, req)));
  assert.equal(new Set(results.map((o) => o.id)).size, 1);
  await endParty(party.id);
  assert.equal((await createOrder(guest.id, req)).id, results[0].id);
  await assert.rejects(createOrder(guest.id, { ...req, toppings: [] }), /andere.*Auswahl/);
  assert.equal((await snapshot(party.id)).orders.length, 1);
});
test('Gast-Snapshots enthalten ausschließlich eigene Bestellungen', async () => {
  const { party, guest } = await fixture();
  const other = await joinParty({ code: party.code, name: 'Ben' });
  await createOrder(guest.id, request());
  await createOrder(other.id, request());
  assert.equal((await snapshot(party.id, guest.id)).orders.length, 1);
  assert.equal((await snapshot(party.id)).orders.length, 2);
});
test('Verfügbarkeit und Bestellung werden bei parallelen Änderungen konsistent serialisiert', async () => {
  const { party, guest } = await fixture();
  const [disable, order] = await Promise.allSettled([
    setAvailability(party.id, 'cheese-0', false),
    createOrder(guest.id, request()),
  ]);
  assert.equal(disable.status, 'fulfilled');
  const state = await snapshot(party.id);
  assert.equal(state.ingredients.find((i) => i.id === 'cheese-0')?.available, false);
  if (order.status === 'fulfilled') assert.equal(state.orders.length, 1);
  else assert.match(String(order.reason), /nicht mehr verfügbar/);
  await assert.rejects(createOrder(guest.id, request()), /nicht mehr verfügbar/);
});
