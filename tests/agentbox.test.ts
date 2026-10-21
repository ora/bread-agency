import { describe, expect, it } from "vitest";
import { GatewayError, parseInboxPage } from "@/lib/agentbox";

describe("parseInboxPage", () => {
  const message = { id: "m1", seq: 3, conversationId: "c1", kind: "request", requestType: "schedule", text: "hi", constraints: {} };

  it("accepts a page shaped like the published client expects", () => {
    const page = parseInboxPage({ messages: [message], cursor: "3", hasMore: false }, 2);
    expect(page).toMatchObject({ cursor: 3, hasMore: false, messages: [{ id: "m1", seq: 3, kind: "request" }] });
  });

  it("rejects a cursor that moves backwards or a message outside the window", () => {
    expect(() => parseInboxPage({ messages: [], cursor: "1", hasMore: false }, 2)).toThrow(GatewayError);
    expect(() => parseInboxPage({ messages: [message], cursor: "2", hasMore: false }, 2)).toThrow(GatewayError);
    expect(() => parseInboxPage({ messages: [{ ...message, seq: "3" }], cursor: "3", hasMore: false }, 2)).toThrow(GatewayError);
  });
});
