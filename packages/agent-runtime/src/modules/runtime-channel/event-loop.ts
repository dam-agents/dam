import type { Event } from "agent-runtime-api";
import type { TriggerImpl } from "./drivers/trigger-impl.js";
import type { StateStore } from "./state-store.js";

export async function processEvents(
  events: Event[],
  triggerImpl: TriggerImpl,
  stateStore: StateStore,
  log: (msg: string) => void,
): Promise<void> {
  const now = Date.now();
  for (const e of events) {
    const cursor = stateStore.read().lastAppliedVersion;
    if (e.version <= cursor) {
      log(
        `[runtime] event ${e.id} (version=${e.version}) already processed; skipping`,
      );
      continue;
    }

    const expiresMs = Date.parse(e.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      log(`[runtime] event ${e.id} expired locally; skipping`);
      continue;
    }

    try {
      await invokeHandler(e, triggerImpl);
      const current = stateStore.read();
      stateStore.write({
        lastAppliedVersion: e.version,
        lastAppliedHash: current.lastAppliedHash,
      });
    } catch (err) {
      log(
        `[runtime] event ${e.id} (${e.kind}) failed: ${(err as Error).message}`,
      );
    }
  }
}

async function invokeHandler(
  e: Event,
  triggerImpl: TriggerImpl,
): Promise<void> {
  switch (e.kind) {
    case "trigger":
      await triggerImpl.handle(e.payload);
      return;
    case "schedule-reset":
      triggerImpl.reset(e.payload.scheduleId);
      return;
  }
}
