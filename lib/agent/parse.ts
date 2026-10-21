/**
 * Read what a customer's agent asked for: which pizzas, how many, and when.
 *
 * Input is another party's message, so it is data only: it can select items
 * from our menu and a time inside our hours, and nothing else. Two forms are
 * accepted, structured first:
 *   constraints: { items: [{ id, qty }], pickupAt: "<RFC 3339>" }
 *   text: "2 margheritas and a loaf for pickup tomorrow at 7pm"
 */

import { BUSINESS, MENU } from "@/lib/menu";
import { addLocalDays, type LocalDate } from "./time";

export interface OrderLine {
  id: string;
  qty: number;
}

export interface PickupRequest {
  /** An exact instant, from structured `pickupAt`. Wins over date/minutes. */
  instant?: Date;
  date?: LocalDate;
  /** Minutes after local midnight. */
  minutes?: number;
}

export interface ParsedOrder {
  lines: OrderLine[];
  pickup: PickupRequest;
}

/** Longer than any honest order; bounds the regex work on hostile input. */
const MAX_TEXT = 2000;
const MAX_LINES = 20;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Every alias with its item, longest first so "sourdough loaf" beats "loaf". */
const ALIASES = MENU.flatMap((item) => item.aliases.map((alias) => ({ alias, id: item.id }))).sort(
  (a, b) => b.alias.length - a.alias.length,
);

export function parseOrder(text: unknown, constraints: unknown, now: Date): ParsedOrder {
  const structured = parseStructured(constraints);
  const normalized = normalize(text);
  return {
    lines: structured.lines.length > 0 ? structured.lines : parseLines(normalized),
    pickup: structured.pickup.instant ? structured.pickup : parsePickup(normalized, now),
  };
}

function normalize(text: unknown): string {
  if (typeof text !== "string") return "";
  return ` ${text.slice(0, MAX_TEXT).toLowerCase().replace(/[^a-z0-9:]+/g, " ")} `;
}

function clampQty(n: number): number {
  return Math.min(BUSINESS.maxPizzasPerOrder, Math.max(1, Math.floor(n)));
}

function mergeLines(lines: OrderLine[]): OrderLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.id, (totals.get(line.id) ?? 0) + line.qty);
  return [...totals].slice(0, MAX_LINES).map(([id, qty]) => ({ id, qty: clampQty(qty) }));
}

function parseStructured(constraints: unknown): ParsedOrder {
  const empty: ParsedOrder = { lines: [], pickup: {} };
  if (!constraints || typeof constraints !== "object") return empty;
  const c = constraints as Record<string, unknown>;

  const lines: OrderLine[] = [];
  if (Array.isArray(c.items)) {
    for (const raw of c.items.slice(0, MAX_LINES)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const key = [r.id, r.item, r.name].find((v): v is string => typeof v === "string");
      const qty = [r.qty, r.quantity].find((v): v is number => typeof v === "number" && Number.isFinite(v));
      const id = key ? itemIdFor(key) : undefined;
      if (id) lines.push({ id, qty: qty ?? 1 });
    }
  }

  const pickup: PickupRequest = {};
  if (typeof c.pickupAt === "string" && c.pickupAt.length <= 40) {
    const instant = new Date(c.pickupAt);
    if (!Number.isNaN(instant.getTime())) pickup.instant = instant;
  }
  return { lines: mergeLines(lines), pickup };
}

/** A menu id from an id, a name, or an alias. */
function itemIdFor(key: string): string | undefined {
  const k = key.trim().toLowerCase();
  return MENU.find((item) => item.id === k || item.name.toLowerCase() === k || item.aliases.includes(k))?.id;
}

function parseLines(normalized: string): OrderLine[] {
  let rest = normalized;
  const lines: OrderLine[] = [];
  for (const { alias, id } of ALIASES) {
    // An optional count, then up to one extra word ("2 sourdough margheritas",
    // "two large pepperoni"), then the alias as whole words.
    const pattern = new RegExp(`(?:\\s(\\d{1,2}|[a-z]+))?(?:\\s[a-z]+)??\\s${alias}(?=\\s)`, "g");
    rest = rest.replace(pattern, (_match, count: string | undefined) => {
      lines.push({ id, qty: countOf(count) });
      return " ";
    });
  }
  return mergeLines(lines);
}

function countOf(word: string | undefined): number {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word) || 1;
  return NUMBER_WORDS[word] ?? 1;
}

function parsePickup(normalized: string, now: Date): PickupRequest {
  const pickup: PickupRequest = {};
  const tz = BUSINESS.timeZone;

  if (/\sday after tomorrow\s/.test(normalized)) pickup.date = addLocalDays(now, 2, tz);
  else if (/\stomorrow\s/.test(normalized)) pickup.date = addLocalDays(now, 1, tz);
  else if (/\s(today|tonight)\s/.test(normalized)) pickup.date = addLocalDays(now, 0, tz);
  else {
    const named = WEEKDAY_NAMES.findIndex((day) => normalized.includes(` ${day} `));
    if (named >= 0) {
      const today = new Date(now).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" }).toLowerCase();
      const ahead = (named - WEEKDAY_NAMES.indexOf(today) + 7) % 7;
      pickup.date = addLocalDays(now, ahead, tz);
    }
  }

  const minutes = parseTime(normalized);
  if (minutes !== undefined) pickup.minutes = minutes;
  return pickup;
}

function parseTime(normalized: string): number | undefined {
  const meridiem = normalized.match(/\s(\d{1,2})(?::([0-5]\d))?\s?(am|pm|a m|p m)\s/);
  if (meridiem) {
    const hour = Number(meridiem[1]);
    if (hour < 1 || hour > 12) return undefined;
    const pm = meridiem[3]!.startsWith("p");
    return ((hour % 12) + (pm ? 12 : 0)) * 60 + Number(meridiem[2] ?? 0);
  }
  const clock = normalized.match(/\s([01]?\d|2[0-3]):([0-5]\d)\s/);
  if (clock) return eveningHour(Number(clock[1])) * 60 + Number(clock[2]);
  const at = normalized.match(/\sat\s(\d{1,2})\s/);
  if (at) {
    const hour = Number(at[1]);
    if (hour >= 1 && hour <= 23) return eveningHour(hour) * 60;
  }
  return undefined;
}

/** Pickup runs in the evening, so a bare "7" or "7:30" means 7 PM. */
function eveningHour(hour: number): number {
  return hour >= 1 && hour <= 11 ? hour + 12 : hour;
}
