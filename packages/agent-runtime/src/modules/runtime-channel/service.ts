import type {
  ApplyStateInput,
  ApplyStateResult,
  DriverFailure,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { Dispatcher } from "./dispatcher.js";
import type { StateStore } from "./state-store.js";
import type { TriggerImpl } from "./drivers/trigger-impl.js";
import type { SeedWorkspaceFn } from "./seed-workspace.js";
import { processEvents, type EventHandlers } from "./event-loop.js";

export interface ApplyStateDeps {
  dispatcher: Dispatcher;
  stateStore: StateStore;
  triggerImpl: TriggerImpl;
  seedWorkspace: SeedWorkspaceFn;
  log: (msg: string) => void;
}

export function createRuntimeChannelService(
  deps: ApplyStateDeps,
): RuntimeChannelService {
  // Serialize applies: the eventRuns/cursor read-modify-write spans an await, so concurrent dispatches (sweep + bump, no jobId dedup) would otherwise double-fire events.
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
  };

  const handlers: EventHandlers = {
    triggerImpl: deps.triggerImpl,
    seedWorkspace: deps.seedWorkspace,
  };

  return {
    applyState(input: ApplyStateInput): Promise<ApplyStateResult> {
      return serialize(() => apply(input));
    },
  };

  async function apply(input: ApplyStateInput): Promise<ApplyStateResult> {
    const local = deps.stateStore.read();
    const kindCounts = countByKind(input.state.contributions);
    const eventCounts = countEventKinds(input.events);
    deps.log(
      `[applyState] incoming v=${input.version} hash=${input.state.hash.slice(0, 8)} local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} contribs={${kindCounts}} events={${eventCounts}}`,
    );

    // Contributions are caught up, but events carry their own version — still apply them (ADR-060).
    if (input.version <= local.lastAppliedVersion) {
      deps.log(
        `[applyState] contributions stale — incoming v=${input.version} <= local v=${local.lastAppliedVersion}; events only`,
      );
      const settledEvents = await processEvents(
        input.events,
        handlers,
        deps.stateStore,
        deps.log,
      );
      return {
        status: "stale",
        appliedVersion: local.lastAppliedVersion,
        settledEvents,
      };
    }

    let failures: DriverFailure[] = [];
    if (input.state.hash !== local.lastAppliedHash) {
      deps.log(
        `[applyState] hash changed (${(local.lastAppliedHash ?? "<none>").slice(0, 8)} → ${input.state.hash.slice(0, 8)}); dispatching ${input.state.contributions.length} contribution(s)`,
      );
      failures = await deps.dispatcher.apply(input.state.contributions);
    } else {
      deps.log(`[applyState] hash unchanged; skipping dispatch`);
    }

    // Events apply in the same pass, independent of contribution outcome (ADR-060).
    const settledEvents = await processEvents(
      input.events,
      handlers,
      deps.stateStore,
      deps.log,
    );

    if (failures.length > 0) {
      const summary = failures.map((f) => `${f.kind}: ${f.message}`).join("; ");
      deps.log(
        `[applyState] driver failure(s) — settling without advancing applied state; returning failures: ${summary}`,
      );
      // Leave the contribution cursor/hash behind so the retry re-dispatches.
      return {
        status: "ok",
        appliedVersion: local.lastAppliedVersion,
        appliedHash: local.lastAppliedHash,
        failures,
        settledEvents,
      };
    }

    // Re-read to preserve the eventRuns just written by processEvents.
    const current = deps.stateStore.read();
    deps.stateStore.write({
      ...current,
      lastAppliedVersion: input.version,
      lastAppliedHash: input.state.hash,
    });
    deps.log(
      `[applyState] applied v=${input.version} hash=${input.state.hash.slice(0, 8)}`,
    );

    return {
      status: "ok",
      appliedVersion: input.version,
      appliedHash: input.state.hash,
      failures: [],
      settledEvents,
    };
  }
}

function countByKind(
  contribs: ApplyStateInput["state"]["contributions"],
): string {
  const counts = new Map<string, number>();
  for (const c of contribs) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  if (counts.size === 0) return "empty";
  return Array.from(counts.entries())
    .map(([k, n]) => `${k}=${n}`)
    .join(",");
}

function countEventKinds(events: ApplyStateInput["events"]): string {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  if (counts.size === 0) return "empty";
  return Array.from(counts.entries())
    .map(([k, n]) => `${k}=${n}`)
    .join(",");
}
