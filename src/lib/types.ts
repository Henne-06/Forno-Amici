import type { ToppingInput } from './domain';
export type Ingredient = {
  id: string;
  name: string;
  category: string;
  available: boolean;
  hasAmount: boolean;
};
export type Order = {
  id: string;
  number: number;
  guestName: string;
  createdAt: string;
  status: 'OPEN' | 'DONE';
  toppings: (ToppingInput & { name: string; categoryName: string })[];
};
export type Snapshot = {
  party: { id: string; name: string; code: string; active: boolean; revision: number };
  ingredients: Ingredient[];
  orders: Order[];
};
export type Party = Snapshot['party'];
