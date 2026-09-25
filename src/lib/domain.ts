import { z } from 'zod';
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const joinSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^FORNO-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
      'Bitte gib einen gültigen Gruppencode ein.',
    ),
  name: z.string().trim().min(1, 'Wie heißt du?').max(40, 'Maximal 40 Zeichen.'),
});
export const partySchema = z.object({ name: z.string().trim().max(60).default('') });
export const toppingSchema = z.object({
  ingredientId: z.string().min(1).max(80),
  position: z.enum(['WHOLE', 'LEFT', 'RIGHT']),
  amount: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
});
export const orderSchema = z
  .object({ idempotencyKey: z.string().uuid(), toppings: z.array(toppingSchema).max(40) })
  .refine(
    (v) => new Set(v.toppings.map((t) => t.ingredientId)).size === v.toppings.length,
    'Jede Zutat darf nur einmal ausgewählt werden.',
  );
export type ToppingInput = z.infer<typeof toppingSchema>;
export function validateToppings(
  toppings: ToppingInput[],
  available: { ingredientId: string; available: boolean; ingredient: { hasAmount: boolean } }[],
) {
  for (const topping of toppings) {
    const item = available.find((i) => i.ingredientId === topping.ingredientId);
    if (!item?.available)
      throw new AppError(
        409,
        'Eine gewählte Zutat ist nicht mehr verfügbar. Bitte prüfe deine Auswahl.',
      );
    if (item.ingredient.hasAmount !== (topping.amount !== null))
      throw new AppError(400, 'Bitte wähle für Käse eine Menge und für andere Beläge keine Menge.');
  }
}
export const positions = { WHOLE: 'Ganze Pizza', LEFT: 'Linke Hälfte', RIGHT: 'Rechte Hälfte' };
export const amounts = { LOW: 'wenig', MEDIUM: 'mittel', HIGH: 'viel' };
