import type { Event } from "agent-runtime-api";
import type { TriggerImpl } from "./drivers/trigger-impl.js";
import type { StateStore } from "./state-store.js";

/** Apply one-shot events independent of contributions; returns the settled ids (failed ones stay pending). */
export async function processEvents(
  events: Event[],
  triggerImpl: TriggerImpl,
  stateStore: StateStore,
  log: (msg: string) => void,
): Promise<string[]> {
  const now = Date.now();
  const settled: string[] = [];
  for (const e of events) {
    const { key, ts } = splitEventId(e.id);
    const state = stateStore.read();
    // Already run: a clean settle reached this version, or a >= fire for this key ran (dedup/supersede).
    if (
      e.version <= state.lastAppliedVersion ||
      ts <= (state.eventRuns[key] ?? 0)
    ) {
      log(`[runtime] event ${e.id} already run; skipping`);
      settled.push(e.id);
      continue;
    }

    const expiresMs = Date.parse(e.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      log(`[runtime] event ${e.id} expired locally; skipping`);
      settled.push(e.id);
      continue;
    }

    try {
      await invokeHandler(e, triggerImpl);
      const current = stateStore.read();
      stateStore.write({
        ...current,
        eventRuns: { ...current.eventRuns, [key]: ts },
      });
      settled.push(e.id);
    } catch (err) {
      log(
        `[runtime] event ${e.id} (${e.kind}) failed: ${(err as Error).message}`,
      );
    }
  }
  return settled;
}

/** Split a `kind:scheduleId:timestamp` event id on its last `:` → dedup key + fire ts. */
function splitEventId(id: string): { key: string; ts: number } {
  const i = id.lastIndexOf(":");
  return { key: id.slice(0, i), ts: Number(id.slice(i + 1)) };
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
