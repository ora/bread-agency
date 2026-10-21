/**
 * Client for NANDA's Agent Box gateway, holding the pizzeria's own mailbox
 * key. Shapes follow the gateway's published client (`/downloads/muse/
 * messagebox.py`) and skill: inbox pages are `{messages, cursor, hasMore}`,
 * replies are `{kind, text, constraints?, idempotencyKey}`.
 *
 * Responses are checked before use and redirects are refused, as the
 * published client does. Message content stays untrusted data.
 */

export type ReplyKind = "proposal" | "accept" | "decline" | "confirm" | "cancel";

export interface InboxMessage {
  id: string;
  seq: number;
  conversationId?: string;
  kind: string;
  requestType?: string;
  text?: string;
  constraints?: Record<string, unknown>;
  sender?: unknown;
}

export interface InboxPage {
  messages: InboxMessage[];
  cursor: number;
  hasMore: boolean;
}

export interface ReplyBody {
  kind: ReplyKind;
  text: string;
  constraints?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface Gateway {
  me(): Promise<{ id: string }>;
  inbox(after: number, limit: number): Promise<InboxPage>;
  /** Returns the id of the message the reply created, when the gateway says. */
  reply(conversationId: string, body: ReplyBody): Promise<{ id?: string }>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }

  /** 409: the protocol does not allow this reply now, or the key was reused. Retrying will not help. */
  get conflict(): boolean {
    return this.status === 409;
  }

  get retryable(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

const TIMEOUT_MS = 10_000;
const DECIMAL = /^\d+$/;

export function createGateway(baseUrl: string, token: string): Gateway {
  const origin = baseUrl.replace(/\/+$/, "");
  if (!origin.startsWith("https://")) throw new Error("AGENTBOX_BASE_URL must be https");

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(origin + path, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new GatewayError(`gateway unreachable: ${(err as Error).message}`);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      throw new GatewayError(error?.message || `gateway answered ${response.status}`, response.status, error?.code);
    }
    if (!payload || typeof payload !== "object") throw new GatewayError("gateway returned no JSON object", response.status);
    return payload as Record<string, unknown>;
  }

  return {
    async me() {
      const profile = await request("GET", "/api/v1/me");
      if (typeof profile.id !== "string" || !profile.id) throw new GatewayError("unexpected mailbox profile");
      return { id: profile.id };
    },

    async inbox(after, limit) {
      const page = await request("GET", `/api/v1/inbox?after=${after}&limit=${limit}`);
      return parseInboxPage(page, after);
    },

    async reply(conversationId, body) {
      const result = await request("POST", `/api/v1/conversations/${encodeURIComponent(conversationId)}/replies`, body);
      return { id: createdId(result) };
    },
  };
}

/** Validate an inbox page the way the published client does. */
export function parseInboxPage(page: Record<string, unknown>, after: number): InboxPage {
  const { messages, cursor, hasMore } = page;
  if (!Array.isArray(messages) || typeof hasMore !== "boolean") throw new GatewayError("unexpected inbox page");
  if (typeof cursor !== "string" || !DECIMAL.test(cursor) || Number(cursor) < after) {
    throw new GatewayError("unexpected inbox cursor");
  }
  const parsed: InboxMessage[] = [];
  for (const raw of messages) {
    const m = raw as Record<string, unknown> | null;
    const seq = m?.seq;
    if (!m || typeof m.id !== "string" || typeof seq !== "number" || !Number.isInteger(seq) || seq <= after || seq > Number(cursor)) {
      throw new GatewayError("unexpected message in inbox page");
    }
    parsed.push({
      id: m.id,
      seq,
      kind: typeof m.kind === "string" ? m.kind : "",
      conversationId: typeof m.conversationId === "string" ? m.conversationId : undefined,
      requestType: typeof m.requestType === "string" ? m.requestType : undefined,
      text: typeof m.text === "string" ? m.text : undefined,
      constraints: m.constraints && typeof m.constraints === "object" ? (m.constraints as Record<string, unknown>) : undefined,
      sender: m.sender,
    });
  }
  return { messages: parsed.sort((a, b) => a.seq - b.seq), cursor: Number(cursor), hasMore };
}

/** The created message's id, wherever this gateway version puts it. */
function createdId(result: Record<string, unknown>): string | undefined {
  for (const candidate of [result, result.message, result.reply]) {
    const id = (candidate as { id?: unknown } | undefined)?.id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
