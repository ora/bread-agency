import "server-only";

import { NextResponse } from "next/server";
import { syncInbox } from "@/lib/agent/sync";
import { syncDepsFromEnv } from "@/lib/env";

/** Run one inbox pass and answer with a summary that carries no message content. */
export async function runSync(trigger: "webhook" | "cron"): Promise<NextResponse> {
  try {
    const result = await syncInbox(syncDepsFromEnv());
    console.log(JSON.stringify({ event: "sync", trigger, status: result.status, handled: result.handled.length }));
    return NextResponse.json({ status: result.status, handled: result.handled.length });
  } catch (err) {
    console.error(JSON.stringify({ event: "sync_failed", trigger, error: (err as Error).message }));
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
