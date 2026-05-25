import type { Event } from "agent-runtime-api";
import type { HarnessClient } from "./harness-client.js";

/**
 * Event loop — invoked after contribution reconciliation per ADR-052. Walks
 * the payload's `events[]` in order; for each event, calls the per-kind work
 * handler on the harness API.
 *
 * The handler is idempotent on event id — a redelivered event hits the
 * unique constraint on the kind's side-effect table and returns the existing
 * row. There's no agent-side dedupe state; the cursor stamp (worker on
 * apply-ack) is the only "stop sending it" signal.
 */
export async function processEvents(
  events: Event[],
  client: HarnessClient,
  log: (msg: string) => void,
): Promise<void> {
  const now = Date.now();
  for (const e of events) {
    // Defense-in-depth — the server's state-builder already filters by
    // expires_at, but agents on slow time-sync should still skip an event
    // that's locally past TTL.
    const expiresMs = Date.parse(e.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      log(`[runtime] event ${e.id} expired locally; skipping`);
      continue;
    }
    try {
      await invokeHandler(e, client);
    } catch (err) {
      log(
        `[runtime] event ${e.id} (${e.kind}) failed: ${(err as Error).message}`,
      );
      // We do NOT abort the loop — the worker will redeliver any event
      // whose cursor hasn't advanced. Continue with the next event so
      // independent kinds aren't head-of-line-blocked.
    }
  }
}

async function invokeHandler(e: Event, client: HarnessClient): Promise<void> {
  switch (e.kind) {
    case "trigger":
      await client.runtime.v1.events.trigger.mutate({
        id: e.id,
        payload: e.payload,
      });
      return;
  }
}
