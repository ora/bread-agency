/**
 * Everything the agent remembers between runs: the inbox cursor, which
 * messages it has handled, open orders, and how full each pickup slot is.
 * Vercel runs each request on whichever instance is free, so all of it lives
 * in Redis; the in-memory version exists for tests only.
 */

import { Redis } from "@upstash/redis";
import type { OrderLine } from "@/lib/agent/parse";

export type OrderStatus = "proposed" | "accepted" | "confirmed" | "cancelled";

export interface Order {
  conversationId: string;
  orderId: string;
  status: OrderStatus;
  lines: OrderLine[];
  pizzas: number;
  totalCents: number;
  /** UTC ISO instant of the pickup slot. */
  pickupAt: string;
  slotKey: string;
  /** Id of our latest proposal message, when the gateway returned it. */
  proposalId?: string;
  /** Whether this order currently holds capacity in its slot. */
  reserved: boolean;
  updatedAt: string;
}

export interface Store {
  getCursor(): Promise<number>;
  setCursor(cursor: number): Promise<void>;
  /** A token when this run holds the sync lock, else null. */
  acquireLock(ttlMs: number): Promise<string | null>;
  releaseLock(token: string): Promise<void>;
  isProcessed(messageId: string): Promise<boolean>;
  markProcessed(messageId: string): Promise<void>;
  /** Count one more failed attempt at a message; returns the new total. */
  recordFailure(messageId: string): Promise<number>;
  getOrder(conversationId: string): Promise<Order | null>;
  putOrder(order: Order): Promise<void>;
  /** A reply saved before sending, so a retry repeats it byte for byte. */
  getDraft<T>(key: string): Promise<T | null>;
  putDraft(key: string, draft: unknown): Promise<void>;
  slotCounts(keys: string[]): Promise<number[]>;
  /**
   * Atomically add `pizzas` to a slot if it stays within `capacity`, once per
   * `holdKey`: repeating a hold that already exists succeeds without adding.
   */
  reserveSlot(key: string, holdKey: string, pizzas: number, capacity: number): Promise<boolean>;
  /** Undo a hold; a no-op when the hold is already gone. */
  releaseSlot(key: string, holdKey: string, pizzas: number): Promise<void>;
}

const PREFIX = "np:";
const MONTH_SECONDS = 30 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const RESERVE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 1 end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local want = tonumber(ARGV[1])
if current + want > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY', KEYS[1], want)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('SET', KEYS[2], want, 'EX', tonumber(ARGV[3]))
return 1`;
const RELEASE_SLOT = `
if redis.call('DEL', KEYS[2]) == 0 then return 0 end
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
redis.call('SET', KEYS[1], math.max(0, current - tonumber(ARGV[1])), 'KEEPTTL')
return 1`;

export function createRedisStore(redis: Redis): Store {
  const k = (key: string) => PREFIX + key;
  return {
    async getCursor() {
      return Number((await redis.get(k("cursor"))) ?? 0) || 0;
    },
    async setCursor(cursor) {
      await redis.set(k("cursor"), cursor);
    },
    async acquireLock(ttlMs) {
      const token = crypto.randomUUID();
      const ok = await redis.set(k("lock"), token, { nx: true, px: ttlMs });
      return ok === "OK" ? token : null;
    },
    async releaseLock(token) {
      await redis.eval(RELEASE_LOCK, [k("lock")], [token]);
    },
    async isProcessed(messageId) {
      return (await redis.exists(k(`msg:${messageId}`))) === 1;
    },
    async markProcessed(messageId) {
      await redis.set(k(`msg:${messageId}`), 1, { ex: MONTH_SECONDS });
    },
    async recordFailure(messageId) {
      const key = k(`fail:${messageId}`);
      const count = await redis.incr(key);
      await redis.expire(key, DAY_SECONDS);
      return count;
    },
    async getOrder(conversationId) {
      return (await redis.get<Order>(k(`order:${conversationId}`))) ?? null;
    },
    async putOrder(order) {
      await redis.set(k(`order:${order.conversationId}`), order, { ex: MONTH_SECONDS });
    },
    async getDraft<T>(key: string) {
      return (await redis.get<T>(k(key))) ?? null;
    },
    async putDraft(key, draft) {
      await redis.set(k(key), draft, { ex: DAY_SECONDS });
    },
    async slotCounts(keys) {
      if (keys.length === 0) return [];
      const values = await redis.mget<(number | string | null)[]>(...keys.map(k));
      return values.map((v) => Number(v ?? 0) || 0);
    },
    async reserveSlot(key, holdKey, pizzas, capacity) {
      const ok = await redis.eval(RESERVE, [k(key), k(holdKey)], [pizzas, capacity, MONTH_SECONDS]);
      return Number(ok) === 1;
    },
    async releaseSlot(key, holdKey, pizzas) {
      await redis.eval(RELEASE_SLOT, [k(key), k(holdKey)], [pizzas]);
    },
  };
}

/** Redis from the env vars the Vercel Marketplace integration sets. */
export function storeFromEnv(): Store {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set");
  return createRedisStore(new Redis({ url, token }));
}

export function createMemoryStore(): Store & { orders: Map<string, Order>; slots: Map<string, number> } {
  let cursor = 0;
  let lock: string | null = null;
  const processed = new Set<string>();
  const failures = new Map<string, number>();
  const orders = new Map<string, Order>();
  const slots = new Map<string, number>();
  const holds = new Set<string>();
  const drafts = new Map<string, unknown>();
  return {
    orders,
    slots,
    async getCursor() { return cursor; },
    async setCursor(next) { cursor = next; },
    async acquireLock() {
      if (lock) return null;
      lock = crypto.randomUUID();
      return lock;
    },
    async releaseLock(token) { if (lock === token) lock = null; },
    async isProcessed(id) { return processed.has(id); },
    async markProcessed(id) { processed.add(id); },
    async recordFailure(id) {
      const n = (failures.get(id) ?? 0) + 1;
      failures.set(id, n);
      return n;
    },
    async getOrder(id) { return structuredClone(orders.get(id) ?? null); },
    async putOrder(order) { orders.set(order.conversationId, structuredClone(order)); },
    async getDraft<T>(key: string) { return structuredClone((drafts.get(key) as T | undefined) ?? null); },
    async putDraft(key, draft) { drafts.set(key, structuredClone(draft)); },
    async slotCounts(keys) { return keys.map((key) => slots.get(key) ?? 0); },
    async reserveSlot(key, holdKey, pizzas, capacity) {
      if (holds.has(holdKey)) return true;
      const current = slots.get(key) ?? 0;
      if (current + pizzas > capacity) return false;
      slots.set(key, current + pizzas);
      holds.add(holdKey);
      return true;
    },
    async releaseSlot(key, holdKey, pizzas) {
      if (!holds.delete(holdKey)) return;
      slots.set(key, Math.max(0, (slots.get(key) ?? 0) - pizzas));
    },
  };
}
