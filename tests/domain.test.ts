import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { joinSchema, orderSchema, validateToppings } from '../src/lib/domain';
test('Join normalisiert Code und Namen; falsche Codes und leere Namen werden abgewiesen', () => {
  assert.deepEqual(joinSchema.parse({ code: ' forno-abc234 ', name: ' Ada ' }), {
    code: 'FORNO-ABC234',
    name: 'Ada',
  });
  assert.equal(joinSchema.safeParse({ code: 'FORNO-000000', name: 'Ada' }).success, false);
  assert.equal(joinSchema.safeParse({ code: 'FORNO-ABC234', name: ' ' }).success, false);
});
test('Whole/Left/Right sind eindeutig; doppelte Zutaten und ungültige Positionen verboten', () => {
  const topping = { ingredientId: 'cheese-0', position: 'LEFT', amount: 'HIGH' };
  for (const position of ['WHOLE', 'LEFT', 'RIGHT'])
    assert.equal(
      orderSchema.safeParse({ idempotencyKey: randomUUID(), toppings: [{ ...topping, position }] })
        .success,
      true,
    );
  assert.equal(
    orderSchema.safeParse({ idempotencyKey: randomUUID(), toppings: [topping, topping] }).success,
    false,
  );
  assert.equal(
    orderSchema.safeParse({
      idempotencyKey: randomUUID(),
      toppings: [{ ...topping, position: 'BOTH' }],
    }).success,
    false,
  );
});
test('Käsemengen und Verfügbarkeit werden serverseitig geprüft', () => {
  const items = [
    { ingredientId: 'cheese', available: true, ingredient: { hasAmount: true } },
    { ingredientId: 'sauce', available: true, ingredient: { hasAmount: false } },
    { ingredientId: 'off', available: false, ingredient: { hasAmount: false } },
  ];
  for (const amount of ['LOW', 'MEDIUM', 'HIGH'] as const)
    assert.doesNotThrow(() =>
      validateToppings([{ ingredientId: 'cheese', position: 'WHOLE', amount }], items),
    );
  assert.throws(() =>
    validateToppings([{ ingredientId: 'cheese', position: 'WHOLE', amount: null }], items),
  );
  assert.throws(() =>
    validateToppings([{ ingredientId: 'sauce', position: 'WHOLE', amount: 'LOW' }], items),
  );
  assert.throws(() =>
    validateToppings([{ ingredientId: 'off', position: 'RIGHT', amount: null }], items),
  );
});
