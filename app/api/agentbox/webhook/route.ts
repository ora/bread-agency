/**
 * The gateway calls this when a message lands in the pizzeria's mailbox.
 *
 * The call is only a wake-up: its body is never read, because the gateway's
 * webhook signature format is not public. The pass reads the inbox with our
 * own key, so a forged call can at most trigger an early, harmless sync.
 */

import { runSync } from "@/lib/run-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  return runSync("webhook");
}
