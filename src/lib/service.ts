import { createHash, randomInt } from 'node:crypto';
import { db } from './db';
import { AppError, joinSchema, orderSchema, partySchema, validateToppings } from './domain';
import type { Prisma } from '../generated/prisma/client';
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = () =>
  'FORNO-' + Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
export async function lockParty(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "PizzaParty" WHERE id = ${id} FOR UPDATE`;
  const party = await tx.pizzaParty.findUnique({ where: { id } });
  if (!party) throw new AppError(404, 'Diese Party wurde nicht gefunden.');
  return party;
}
export async function createParty(input: unknown) {
  const { name } = partySchema.parse(input);
  const ingredients = await db.ingredient.findMany({ select: { id: true } });
  if (!ingredients.length) throw new AppError(503, 'Bitte zuerst die Zutaten mit db:seed anlegen.');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.pizzaParty.create({
        data: {
          name: name || 'Pizza bei Freunden',
          code: code(),
          ingredients: { create: ingredients.map((i) => ({ ingredientId: i.id })) },
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
  throw new AppError(503, 'Die Party konnte nicht erstellt werden. Bitte versuche es erneut.');
}
export async function joinParty(input: unknown) {
  const { name, code } = joinSchema.parse(input);
  return db.$transaction(async (tx) => {
    const found = await tx.pizzaParty.findUnique({ where: { code } });
    if (!found)
      throw new AppError(404, 'Diesen Gruppencode kennen wir nicht. Bitte prüfe ihn noch einmal.');
    const party = await lockParty(tx, found.id);
    if (!party.active) throw new AppError(409, 'Diese Party ist bereits beendet.');
    return tx.guest.create({ data: { name, partyId: party.id } });
  });
}
export async function createOrder(guestId: string, input: unknown) {
  const parsed = orderSchema.parse(input);
  const toppings = [...parsed.toppings].sort((a, b) =>
    a.ingredientId.localeCompare(b.ingredientId),
  );
  const requestHash = createHash('sha256').update(JSON.stringify(toppings)).digest('hex');
  return db.$transaction(
    async (tx) => {
      const guest = await tx.guest.findUnique({ where: { id: guestId } });
      if (!guest) throw new AppError(401, 'Bitte tritt der Party erneut bei.');
      const party = await lockParty(tx, guest.partyId);
      const previous = await tx.order.findUnique({
        where: { guestId_idempotencyKey: { guestId, idempotencyKey: parsed.idempotencyKey } },
        include: { toppings: true },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new AppError(
            409,
            'Diese Bestellanfrage wurde bereits mit einer anderen Auswahl verwendet.',
          );
        return previous;
      }
      if (!party.active)
        throw new AppError(
          409,
          'Die Party ist beendet. Neue Bestellungen sind nicht mehr möglich.',
        );
      const available = await tx.partyIngredient.findMany({
        where: { partyId: party.id },
        include: { ingredient: { include: { category: true } } },
      });
      validateToppings(toppings, available);
      const updated = await tx.pizzaParty.update({
        where: { id: party.id },
        data: { nextNumber: { increment: 1 }, revision: { increment: 1 } },
      });
      return tx.order.create({
        data: {
          partyId: party.id,
          guestId,
          guestName: guest.name,
          number: updated.nextNumber,
          idempotencyKey: parsed.idempotencyKey,
          requestHash,
          toppings: {
            create: toppings.map((t) => {
              const ingredient = available.find(
                (a) => a.ingredientId === t.ingredientId,
              )!.ingredient;
              return { ...t, name: ingredient.name, categoryName: ingredient.category.name };
            }),
          },
        },
        include: { toppings: true },
      });
    },
    { maxWait: 10000, timeout: 15000 },
  );
}
export async function setAvailability(partyId: string, ingredientId: string, available: boolean) {
  return db.$transaction(async (tx) => {
    const party = await lockParty(tx, partyId);
    if (!party.active) throw new AppError(409, 'Diese Party ist bereits beendet.');
    const item = await tx.partyIngredient.findUnique({
      where: { partyId_ingredientId: { partyId, ingredientId } },
    });
    if (!item) throw new AppError(404, 'Zutat nicht gefunden.');
    await tx.partyIngredient.update({
      where: { partyId_ingredientId: { partyId, ingredientId } },
      data: { available },
    });
    await tx.pizzaParty.update({ where: { id: partyId }, data: { revision: { increment: 1 } } });
  });
}
export async function endParty(partyId: string) {
  return db.$transaction(async (tx) => {
    await lockParty(tx, partyId);
    await tx.pizzaParty.update({
      where: { id: partyId },
      data: { active: false, revision: { increment: 1 } },
    });
  });
}
export async function setOrderStatus(partyId: string, id: string, status: 'OPEN' | 'DONE') {
  return db.$transaction(async (tx) => {
    await lockParty(tx, partyId);
    const order = await tx.order.findFirst({ where: { id, partyId } });
    if (!order) throw new AppError(404, 'Bestellung nicht gefunden.');
    await tx.order.update({
      where: { id },
      data: { status, completedAt: status === 'DONE' ? new Date() : null },
    });
    await tx.pizzaParty.update({ where: { id: partyId }, data: { revision: { increment: 1 } } });
  });
}
export async function snapshot(partyId: string, guestId?: string) {
  return db.$transaction(
    async (tx) => {
      const party = await tx.pizzaParty.findUnique({
        where: { id: partyId },
        select: { id: true, name: true, code: true, active: true, revision: true },
      });
      if (!party) throw new AppError(404, 'Party nicht gefunden.');
      const ingredients = await tx.partyIngredient.findMany({
        where: { partyId },
        include: { ingredient: { include: { category: true } } },
        orderBy: [
          { ingredient: { category: { sortOrder: 'asc' } } },
          { ingredient: { sortOrder: 'asc' } },
        ],
      });
      const orders = await tx.order.findMany({
        where: { partyId, ...(guestId ? { guestId } : {}) },
        select: {
          id: true,
          number: true,
          guestName: true,
          createdAt: true,
          status: true,
          toppings: {
            select: {
              ingredientId: true,
              name: true,
              categoryName: true,
              position: true,
              amount: true,
            },
          },
        },
        orderBy: { number: 'asc' },
      });
      return {
        party,
        ingredients: ingredients.map((i) => ({
          id: i.ingredientId,
          available: i.available,
          name: i.ingredient.name,
          hasAmount: i.ingredient.hasAmount,
          category: i.ingredient.category.name,
        })),
        orders,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function rateLimit(key: string, maximum: number, windowSeconds = 60) {
  const hashedKey = createHash('sha256').update(key).digest('hex');
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" (key, count, "expiresAt") VALUES (${hashedKey}, 1, NOW() + ${windowSeconds} * INTERVAL '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN 1 ELSE "RateLimit".count + 1 END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN NOW() + ${windowSeconds} * INTERVAL '1 second' ELSE "RateLimit"."expiresAt" END
    RETURNING count`;
  if (randomInt(100) === 0)
    await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if (rows[0].count > maximum)
    throw new AppError(429, 'Kurz durchatmen: Bitte versuche es in einer Minute erneut.');
}
