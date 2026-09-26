import type { Event } from "agent-runtime-api";
import { isWorkspaceMutationEventKind } from "agent-runtime-api";

import type { EventDispatcher } from "./dispatcher.js";
import type { StateStore } from "./state-store.js";

export type WorkspaceFailureReport = (
  event: Event,
  message: string,
) => Promise<void>;

export async function processEvents(
  events: Event[],
  dispatcher: EventDispatcher,
  stateStore: StateStore,
  log: (msg: string) => void,
  reportWorkspaceFailure?: WorkspaceFailureReport,
): Promise<string[]> {
  const now = Date.now();
  const settled: string[] = [];
  for (const e of events) {
    const { key, ts } = splitEventId(e.id);
    if (!Number.isFinite(ts)) {
      log(`[runtime] event ${e.id} has a malformed id; settling without run`);
      settled.push(e.id);
      continue;
    }
    const state = stateStore.read();
    if (ts <= (state.eventRuns[key] ?? 0)) {
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
      await dispatcher.invoke(e.kind, e.payload, e.id);
      const current = stateStore.read();
      stateStore.write({
        ...current,
        eventRuns: { ...current.eventRuns, [key]: ts },
      });
      settled.push(e.id);
    } catch (err) {
      const message = (err as Error).message;
      log(`[runtime] event ${e.id} (${e.kind}) failed: ${message}`);
      if (isWorkspaceMutationEventKind(e.kind)) {
        await reportWorkspaceFailure?.(e, message);
        log(
          `[runtime] holding the events behind ${e.id} until the workspace mutation settles`,
        );
        break;
      }
    }
  }
  return settled;
}

function splitEventId(id: string): { key: string; ts: number } {
  const i = id.lastIndexOf(":");
  return { key: id.slice(0, i), ts: Number(id.slice(i + 1)) };
}
