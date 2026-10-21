/** Served at /.well-known/ai-catalog.json (rewrite in next.config.ts). */

import { NextResponse } from "next/server";
import { BUSINESS } from "@/lib/menu";
import { agentCardUrl, agentLocator } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  const cardUrl = agentCardUrl();
  const locator = agentLocator();
  const entries = cardUrl
    ? [
        {
          identifier: `urn:air:${BUSINESS.domain}:agent:orders`,
          displayName: `${BUSINESS.name} orders`,
          type: "application/mcp-server-card+json",
          url: cardUrl,
          description:
            `Ordering agent for ${BUSINESS.name}, sourdough pizza for pickup in ${BUSINESS.city}. ` +
            `Send it a request through NANDA Agent Box (${locator}); it proposes an order and a pickup slot. ` +
            "A demo business run by Ora for NANDA: no food is made and nothing is charged.",
          tags: ["pizza", "food", "pickup", "orders", "nanda", "agent-box", "demo"],
          representativeQueries: [
            "order sourdough pizza for pickup tomorrow evening",
            "two margheritas for pickup at 7pm",
            "pizza place in Cambridge with an ordering agent",
          ],
        },
      ]
    : [];
  return NextResponse.json(
    {
      specVersion: "1.0",
      host: { displayName: BUSINESS.name, identifier: `did:web:${BUSINESS.domain}`, documentationUrl: `https://${BUSINESS.domain}/llms.txt` },
      entries,
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
