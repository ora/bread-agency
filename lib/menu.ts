/**
 * The pizzeria's fixed facts: what it sells, when it hands orders out, and
 * where. Everything the agent says about the business comes from here, never
 * from a message it received.
 */

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  /** Lowercase words a customer might use for this pizza. */
  aliases: string[];
}

export const BUSINESS = {
  name: "Nanda Pizza",
  domain: "nanda.pizza",
  city: "Cambridge, Massachusetts",
  timeZone: "America/New_York",
  currency: "USD",
  /** Pickup runs every day between these local times, in slots of this size. */
  opensAtMinutes: 17 * 60,
  closesAtMinutes: 21 * 60,
  slotMinutes: 15,
  /** How many pizzas the oven can turn out per slot. */
  pizzasPerSlot: 6,
  /** The earliest pickup is at least this far from now. */
  leadMinutes: 30,
  /** How far ahead an order can be placed. */
  orderWindowDays: 7,
  maxPizzasPerOrder: 12,
} as const;

export const MENU: readonly MenuItem[] = [
  {
    id: "margherita",
    name: "Sourdough Margherita",
    description: "San Marzano tomato, fior di latte, basil, olive oil.",
    priceCents: 1600,
    aliases: ["margherita", "margarita", "margheritas", "margaritas"],
  },
  {
    id: "marinara",
    name: "Marinara",
    description: "Tomato, garlic, oregano, olive oil. No cheese.",
    priceCents: 1300,
    aliases: ["marinara", "marinaras"],
  },
  {
    id: "pepperoni",
    name: "Pepperoni",
    description: "Tomato, mozzarella, cup-and-char pepperoni.",
    priceCents: 1800,
    aliases: ["pepperoni", "pepperonis"],
  },
  {
    id: "funghi",
    name: "Funghi",
    description: "Roasted mushrooms, mozzarella, thyme, garlic cream.",
    priceCents: 1900,
    aliases: ["funghi", "mushroom", "mushrooms"],
  },
  {
    id: "sourdough-loaf",
    name: "Sourdough Loaf",
    description: "A whole loaf from the same dough, baked that afternoon.",
    priceCents: 900,
    aliases: ["loaf", "loaves", "sourdough loaf", "sourdough loaves", "bread"],
  },
];

export function menuItem(id: string): MenuItem | undefined {
  return MENU.find((item) => item.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The menu as one plain line per item, for message text and llms.txt. */
export function menuLines(): string[] {
  return MENU.map((item) => `${item.name} (${formatPrice(item.priceCents)}): ${item.description}`);
}
