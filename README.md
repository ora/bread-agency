# nanda.pizza

A demo pizzeria whose ordering agent talks to other people's AI assistants through NANDA's Agent Box. It shows an agent on Ora's island (this business, found and ranked through Ora's registry) doing business with an agent on NANDA's island (a person's Agent Box), with credentials and the person's consent at every step.

**A demo by [Ora](https://ora.ai) for [NANDA](https://nandaindex.org). No food is made and nothing is charged.**

## How an order works

The pizzeria has its own Agent Box mailbox on NANDA's gateway and follows the gateway's conversation protocol:

1. A customer's assistant sends the pizzeria a `schedule` request ("2 margheritas for pickup tomorrow at 7pm"), or structured `constraints: {items: [{id, qty}], pickupAt}`.
2. The pizzeria replies with a `proposal`: items, total, pickup slot and order number, in `text` and `constraints`.
3. The customer's assistant asks its person, then sends `accept` naming that proposal. The pizzeria holds the slot.
4. The customer's assistant (the requester) sends `confirm`. The order is placed.

A counter-proposal ("8pm instead?") gets a new proposal. `decline` or `cancel` releases the slot. A general question gets the menu.

Every reply is built only from the menu and order data in `lib/menu.ts`; nothing a customer sent is quoted back. Every write is safe to retry: proposals are saved as drafts and resent byte for byte under the same idempotency key, and slot holds are recorded once per order.

## Layout

| Path | What it does |
| --- | --- |
| `lib/menu.ts` | The business: menu, prices, pickup hours, oven capacity |
| `lib/agent/parse.ts` | Reads items and a pickup time from a message |
| `lib/agent/slots.ts` | Finds the nearest pickup slot with room |
| `lib/agent/respond.ts` | What to do with one inbox message |
| `lib/agent/sync.ts` | One pass over the inbox, cursor and lock |
| `lib/agentbox.ts` | Client for the Agent Box gateway |
| `lib/store.ts` | State in Upstash Redis (in memory for tests) |
| `app/api/agentbox/webhook` | Gateway wake-up; triggers a sync, never reads the body |
| `app/api/cron/sync` | Every-minute fallback sync (Vercel Cron) |
| `app/llms.txt`, `/.well-known/ai-catalog.json` | How agents find the ordering agent |

## Setup

1. **Vercel project** with the Upstash Redis integration (sets `KV_REST_API_URL`, `KV_REST_API_TOKEN`). Every-minute cron needs a Pro team.
2. **The pizzeria's Agent Box.** Give an assistant NANDA's skill (`https://my.nandaindex.org/agent/SKILL.md`), an email Ora controls, the display name "Nanda Pizza" and the description "Sourdough pizza for pickup in Cambridge, Massachusetts. Order pizzas for pickup today or tomorrow." Enter the six-digit code. Put the mailbox key in Vercel as `AGENTBOX_TOKEN` (never in chat or a file) and the mailbox address as `AGENTBOX_ADDRESS`.
3. **`CRON_SECRET`**: any long random string, in Vercel.
4. **Deploy**, then attach `nanda.pizza` once the deploy serves.
5. **Webhook**: register `https://nanda.pizza/api/agentbox/webhook` with the gateway (`POST /api/v1/webhooks {"url": ...}` using the mailbox key).

All variables are listed in `.env.example`.

## Develop

```sh
npm install
npm test          # unit and flow tests, no network
npm run typecheck
npm run lint
npm run dev
```
