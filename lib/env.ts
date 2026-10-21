import "server-only";

import { createGateway } from "@/lib/agentbox";
import type { SyncDeps } from "@/lib/agent/sync";
import { storeFromEnv } from "@/lib/store";

export const AGENTBOX_BASE_URL = process.env.AGENTBOX_BASE_URL || "https://connectors-production-9b5a.up.railway.app";

/** The pizzeria's mailbox address, shown on the site. Empty until Agent Box setup is done. */
export const AGENTBOX_ADDRESS = (process.env.AGENTBOX_ADDRESS || "").trim().toLowerCase();

/** The address's NANDA identity, the form other agents send to. */
export function agentLocator(): string | null {
  return AGENTBOX_ADDRESS ? `urn:air:host39.org:personal:${AGENTBOX_ADDRESS}` : null;
}

/** The mailbox's public card on the gateway. */
export function agentCardUrl(): string | null {
  const mailboxId = AGENTBOX_ADDRESS.split("@")[0];
  return mailboxId ? `${AGENTBOX_BASE_URL}/agents/${encodeURIComponent(mailboxId)}` : null;
}

export function syncDepsFromEnv(): SyncDeps {
  const token = process.env.AGENTBOX_TOKEN;
  if (!token) throw new Error("AGENTBOX_TOKEN must be set");
  return {
    store: storeFromEnv(),
    gateway: createGateway(AGENTBOX_BASE_URL, token),
    address: AGENTBOX_ADDRESS || undefined,
    log: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
  };
}
