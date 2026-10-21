/**
 * One pass over the pizzeria's inbox: read new messages oldest first, handle
 * each, and move the cursor past it only once it is handled. A lock keeps
 * the webhook and the cron from working the inbox at the same time.
 *
 * A message that fails for a retryable reason stops the pass and is tried
 * again next time. One the gateway refuses outright (409, or five failed
 * attempts) is logged and skipped so it cannot block the inbox.
 */

import { GatewayError, type Gateway } from "@/lib/agentbox";
import type { Store } from "@/lib/store";
import { handleMessage, type Outcome } from "./respond";

const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const LOCK_TTL_MS = 55_000;
const MAX_ATTEMPTS = 5;

export interface SyncDeps {
  store: Store;
  gateway: Gateway;
  /** The pizzeria's public mailbox address, also never answered. */
  address?: string;
  now?: () => Date;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export interface SyncResult {
  status: "done" | "locked";
  handled: { id: string; outcome: Outcome | "skipped" }[];
  cursor?: number;
}

export async function syncInbox(deps: SyncDeps): Promise<SyncResult> {
  const { store, gateway } = deps;
  const log = deps.log ?? (() => {});
  const token = await store.acquireLock(LOCK_TTL_MS);
  if (!token) return { status: "locked", handled: [] };

  const handled: SyncResult["handled"] = [];
  try {
    const me = await gateway.me();
    const self = new Set([me.id, deps.address].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase()));
    let cursor = await store.getCursor();

    for (let page = 0; page < MAX_PAGES; page++) {
      const inbox = await gateway.inbox(cursor, PAGE_SIZE);
      for (const message of inbox.messages) {
        if (!(await store.isProcessed(message.id))) {
          const outcome = await handleOne(message, deps, self, log);
          if (outcome === "retry") return { status: "done", handled, cursor };
          handled.push({ id: message.id, outcome });
          await store.markProcessed(message.id);
        }
        cursor = message.seq;
        await store.setCursor(cursor);
      }
      if (inbox.cursor > cursor) {
        cursor = inbox.cursor;
        await store.setCursor(cursor);
      }
      if (!inbox.hasMore) break;
    }
    return { status: "done", handled, cursor };
  } finally {
    await store.releaseLock(token);
  }
}

async function handleOne(
  message: Parameters<typeof handleMessage>[0],
  deps: SyncDeps,
  self: ReadonlySet<string>,
  log: NonNullable<SyncDeps["log"]>,
): Promise<Outcome | "skipped" | "retry"> {
  try {
    const outcome = await handleMessage(message, {
      store: deps.store,
      gateway: deps.gateway,
      now: (deps.now ?? (() => new Date()))(),
      self,
    });
    log("message_handled", { id: message.id, kind: message.kind, outcome });
    return outcome;
  } catch (err) {
    const status = err instanceof GatewayError ? err.status : undefined;
    const permanent = err instanceof GatewayError && err.conflict;
    const attempts = await deps.store.recordFailure(message.id);
    log("message_failed", { id: message.id, kind: message.kind, status, attempts, error: (err as Error).message });
    return permanent || attempts >= MAX_ATTEMPTS ? "skipped" : "retry";
  }
}
