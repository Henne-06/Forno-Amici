import 'dotenv/config';
import { db } from '../src/lib/db';
const categories = [
  { id: 'sauce', name: 'Sauce', ingredients: ['Tomatensauce', 'Crème fraîche'] },
  { id: 'cheese', name: 'Käse', ingredients: ['Mozzarella', 'Parmesan', 'Gorgonzola'] },
  { id: 'meat', name: 'Fleisch & Wurst', ingredients: ['Salami', 'Kochschinken', 'Parmaschinken'] },
  {
    id: 'vegetables',
    name: 'Gemüse',
    ingredients: ['Champignons', 'Paprika', 'Rote Zwiebeln', 'Kirschtomaten', 'Oliven'],
  },
  {
    id: 'extras',
    name: 'Weitere Beläge',
    ingredients: ['Basilikum', 'Rucola', 'Chili', 'Knoblauchöl'],
  },
];
export async function seed() {
  await db.$transaction(async (tx) => {
    for (const [sortOrder, category] of categories.entries()) {
      await tx.ingredientCategory.upsert({
        where: { id: category.id },
        create: { id: category.id, name: category.name, sortOrder },
        update: { name: category.name, sortOrder },
      });
      for (const [index, name] of category.ingredients.entries()) {
        const data = {
          name,
          categoryId: category.id,
          hasAmount: category.id === 'cheese',
          sortOrder: index,
        };
        await tx.ingredient.upsert({
          where: { id: `${category.id}-${index}` },
          create: { id: `${category.id}-${index}`, ...data },
          update: data,
        });
      }
    }
  });
}
if (process.argv[1]?.endsWith('seed.ts'))
  seed()
    .then(() => console.log('Zutaten angelegt.'))
    .finally(() => db.$disconnect());
