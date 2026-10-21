import type { Gateway, InboxMessage, InboxPage, ReplyBody } from "@/lib/agentbox";

/**
 * A gateway that keeps messages and replies in memory. Message shapes follow
 * the gateway's documented inbox schema (id, seq, conversationId, kind,
 * requestType, text, constraints, sender).
 */
export function fakeGateway(selfId = "nandapizza") {
  const messages: InboxMessage[] = [];
  const replies: { conversationId: string; body: ReplyBody; id: string }[] = [];
  const failNext: Error[] = [];
  let seq = 0;

  const gateway: Gateway = {
    async me() {
      return { id: selfId };
    },
    async inbox(after, limit): Promise<InboxPage> {
      const page = messages.filter((m) => m.seq > after).slice(0, limit);
      const last = page.at(-1)?.seq ?? after;
      return { messages: page, cursor: last, hasMore: messages.some((m) => m.seq > last) };
    },
    async reply(conversationId, body) {
      const error = failNext.shift();
      if (error) throw error;
      const existing = replies.find((r) => r.body.idempotencyKey === body.idempotencyKey);
      if (existing) {
        if (JSON.stringify(existing.body) !== JSON.stringify(body)) throw new Error("changed payload for idempotency key");
        return { id: existing.id };
      }
      const id = `out-${replies.length + 1}`;
      replies.push({ conversationId, body, id });
      return { id };
    },
  };

  function deliver(m: Omit<InboxMessage, "seq" | "id"> & { id?: string }): InboxMessage {
    seq += 1;
    const message = { id: m.id ?? `in-${seq}`, seq, ...m } as InboxMessage;
    messages.push(message);
    return message;
  }

  return { gateway, messages, replies, failNext, deliver };
}

/** Wednesday 2026-10-21, 4:00 PM in New York. */
export const NOW = new Date("2026-10-21T20:00:00Z");
