/**
 * What the pizzeria does with one inbox message, under the gateway's
 * conversation protocol: the customer's agent opens with a request, we
 * propose an order, they accept, and they (the requester) confirm. Either
 * side may send a newer proposal; decline or cancel ends it.
 *
 * Every write is safe to repeat. A proposal is saved as a draft before it is
 * sent, so a retry re-sends the same bytes under the same idempotency key
 * rather than a recomputed one the gateway would reject as a changed payload.
 * Slot holds are keyed per order, so a retried accept cannot hold twice.
 */

import { createHash } from "node:crypto";
import { BUSINESS, menuItem } from "@/lib/menu";
import type { Gateway, InboxMessage, ReplyBody } from "@/lib/agentbox";
import type { Order, Store } from "@/lib/store";
import { infoText, needItemsText, noSlotText, proposalText } from "./messages";
import { parseOrder, type OrderLine, type PickupRequest } from "./parse";
import { candidateSlots, pickSlot, requestedInstant, slotKey } from "./slots";
import { addLocalDays, isoLocal, localParts } from "./time";

export interface HandleDeps {
  store: Store;
  gateway: Gateway;
  now: Date;
  /** Our own mailbox id and address, so we never answer ourselves. */
  self: ReadonlySet<string>;
}

export type Outcome =
  | "ignored"
  | "answered"
  | "proposed"
  | "declined"
  | "accepted"
  | "confirmed"
  | "cancelled";

interface Draft {
  body: ReplyBody;
  order?: Order;
}

export async function handleMessage(m: InboxMessage, deps: HandleDeps): Promise<Outcome> {
  if (!m.conversationId || m.constraints?.channel === "email" || isFromSelf(m, deps.self)) return "ignored";
  switch (m.kind) {
    case "request":
      return onRequest(m, m.conversationId, deps);
    case "proposal":
      return onCounterProposal(m, m.conversationId, deps);
    case "accept":
      return onAccept(m, m.conversationId, deps);
    case "confirm":
      return onConfirm(m.conversationId, deps);
    case "decline":
    case "cancel":
      return onEnd(m.conversationId, deps);
    default:
      return "ignored";
  }
}

async function onRequest(m: InboxMessage, conversationId: string, deps: HandleDeps): Promise<Outcome> {
  const parsed = parseOrder(m.text, m.constraints, deps.now);
  if (parsed.lines.length === 0) {
    const text = m.requestType === "schedule" ? needItemsText() : infoText();
    await send(m, conversationId, deps, () => ({ body: { kind: "proposal", text, idempotencyKey: key(m, "proposal") } }));
    return "answered";
  }
  return propose(m, conversationId, parsed.lines, parsed.pickup, undefined, deps);
}

async function onCounterProposal(m: InboxMessage, conversationId: string, deps: HandleDeps): Promise<Outcome> {
  const order = await deps.store.getOrder(conversationId);
  if (!order || order.status === "confirmed" || order.status === "cancelled") return "ignored";
  const parsed = parseOrder(m.text, m.constraints, deps.now);
  return propose(
    m,
    conversationId,
    parsed.lines.length > 0 ? parsed.lines : order.lines,
    counterPickup(parsed.pickup, order),
    order,
    deps,
  );
}

/** A counter keeps whatever part of the pickup it does not change: "8pm instead" keeps the day. */
function counterPickup(pickup: PickupRequest, order: Order): PickupRequest {
  const previous = new Date(order.pickupAt);
  if (pickup.instant || (pickup.date && pickup.minutes !== undefined)) return pickup;
  if (pickup.minutes !== undefined) return { date: addLocalDays(previous, 0, BUSINESS.timeZone), minutes: pickup.minutes };
  if (pickup.date) {
    const p = localParts(previous, BUSINESS.timeZone);
    return { date: pickup.date, minutes: p.hour * 60 + p.minute };
  }
  return { instant: previous };
}

async function onAccept(m: InboxMessage, conversationId: string, deps: HandleDeps): Promise<Outcome> {
  const order = await deps.store.getOrder(conversationId);
  if (!order || order.status !== "proposed") return "ignored";
  const acceptedId = m.constraints?.proposalId;
  if (order.proposalId && typeof acceptedId === "string" && acceptedId !== order.proposalId) return "ignored";

  if (await deps.store.reserveSlot(order.slotKey, holdKey(order), order.pizzas, BUSINESS.pizzasPerSlot)) {
    await deps.store.putOrder({ ...order, status: "accepted", reserved: true, updatedAt: deps.now.toISOString() });
    return "accepted";
  }
  // The slot filled up between proposal and acceptance: offer the next one.
  return propose(m, conversationId, order.lines, { instant: new Date(order.pickupAt) }, order, deps);
}

async function onConfirm(conversationId: string, deps: HandleDeps): Promise<Outcome> {
  const order = await deps.store.getOrder(conversationId);
  if (!order || order.status !== "accepted") return "ignored";
  await deps.store.putOrder({ ...order, status: "confirmed", updatedAt: deps.now.toISOString() });
  return "confirmed";
}

async function onEnd(conversationId: string, deps: HandleDeps): Promise<Outcome> {
  const order = await deps.store.getOrder(conversationId);
  if (!order || order.status === "cancelled") return "ignored";
  if (order.reserved) await deps.store.releaseSlot(order.slotKey, holdKey(order), order.pizzas);
  await deps.store.putOrder({ ...order, status: "cancelled", reserved: false, updatedAt: deps.now.toISOString() });
  return "cancelled";
}

async function propose(
  m: InboxMessage,
  conversationId: string,
  lines: OrderLine[],
  pickup: PickupRequest,
  previous: Order | undefined,
  deps: HandleDeps,
): Promise<Outcome> {
  const draft = await send(m, conversationId, deps, async () => {
    const pizzas = lines.reduce((sum, line) => sum + line.qty, 0);
    const candidates = pizzas <= BUSINESS.maxPizzasPerOrder ? candidateSlots(pickup, deps.now) : [];
    const slot = pickSlot(candidates, await deps.store.slotCounts(candidates.map(slotKey)), pizzas);
    if (!slot) return { body: { kind: "decline", text: noSlotText(), idempotencyKey: key(m, "decline") } };

    const requested = requestedInstant(pickup, deps.now);
    const adjusted = requested !== undefined && slot.getTime() - requested.getTime() >= BUSINESS.slotMinutes * 60_000;
    const orderId = previous?.orderId ?? orderIdFor(conversationId);
    const totalCents = lines.reduce((sum, line) => sum + (menuItem(line.id)?.priceCents ?? 0) * line.qty, 0);
    const body: ReplyBody = {
      kind: "proposal",
      text: proposalText({ lines, totalCents, pickup: slot, orderId, adjusted }),
      constraints: {
        orderId,
        items: lines.map((line) => ({
          id: line.id,
          name: menuItem(line.id)?.name,
          qty: line.qty,
          unitPriceCents: menuItem(line.id)?.priceCents,
        })),
        totalCents,
        currency: BUSINESS.currency,
        pickupAt: isoLocal(slot, BUSINESS.timeZone),
        pickupLocation: `${BUSINESS.name}, ${BUSINESS.city}`,
        demo: true,
      },
      idempotencyKey: key(m, "proposal"),
    };
    const order: Order = {
      conversationId,
      orderId,
      status: "proposed",
      lines,
      pizzas,
      totalCents,
      pickupAt: slot.toISOString(),
      slotKey: slotKey(slot),
      reserved: false,
      updatedAt: deps.now.toISOString(),
    };
    return { body, order };
  });

  if (!draft.order) {
    if (previous) await onEnd(conversationId, deps);
    return "declined";
  }
  // A newer proposal replaces whatever the previous one held.
  if (previous?.reserved) await deps.store.releaseSlot(previous.slotKey, holdKey(previous), previous.pizzas);
  await deps.store.putOrder({ ...draft.order, proposalId: draft.sentId });
  return "proposed";
}

/** Send a reply built once and saved, so a retry repeats it exactly. */
async function send(
  m: InboxMessage,
  conversationId: string,
  deps: HandleDeps,
  build: () => Draft | Promise<Draft>,
): Promise<Draft & { sentId?: string }> {
  const draftKey = `draft:${m.id}`;
  const draft = (await deps.store.getDraft<Draft>(draftKey)) ?? (await build());
  await deps.store.putDraft(draftKey, draft);
  const { id } = await deps.gateway.reply(conversationId, draft.body);
  return { ...draft, sentId: id };
}

/** The skill's suggested key: one per message answered and reply kind. */
function key(m: InboxMessage, kind: string): string {
  return `reply-${m.id}-${kind}`;
}

function holdKey(order: Order): string {
  return `hold:${order.conversationId}:${order.slotKey}`;
}

export function orderIdFor(conversationId: string): string {
  return `NP-${createHash("sha256").update(conversationId).digest("hex").slice(0, 6).toUpperCase()}`;
}

function isFromSelf(m: InboxMessage, self: ReadonlySet<string>): boolean {
  const candidates: unknown[] = [m.sender, m.constraints?.from];
  if (m.sender && typeof m.sender === "object") {
    const s = m.sender as Record<string, unknown>;
    candidates.push(s.id, s.mailboxId, s.address, s.emailAddress, s.locator);
  }
  return candidates.some((c) => typeof c === "string" && self.has(c.toLowerCase()));
}
