import type {
  ApplyStateInput,
  ApplyStateResult,
  DriverFailure,
  HarnessConfigCurrent,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { Dispatcher } from "./dispatcher.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import type { StateStore } from "./state-store.js";
import { processEvents } from "./event-loop.js";

export interface ApplyStateDeps {
  dispatcher: Dispatcher;
  eventDispatcher: EventDispatcher;
  stateStore: StateStore;
  readHarnessConfig: () => Promise<HarnessConfigCurrent | undefined>;
  log: (msg: string) => void;
}

export function createRuntimeChannelService(
  deps: ApplyStateDeps,
): RuntimeChannelService {
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => {});
    return run;
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

    // Strictly older only. At the same version the hash decides: the server may
    // re-deliver one version with different contributions (a row reaped without
    // a bump), and refusing on the version alone would leave that difference
    // unapplied forever. Events carry their own version — still apply them.
    if (input.version < local.lastAppliedVersion) {
      deps.log(
        `[applyState] contributions stale — incoming v=${input.version} < local v=${local.lastAppliedVersion}; events only`,
      );
      const settledEvents = await processEvents(
        input.events,
        deps.eventDispatcher,
        deps.stateStore,
        deps.log,
      );
      return {
        status: "stale",
        appliedVersion: local.lastAppliedVersion,
        settledEvents,
        harnessConfigCurrent: await deps.readHarnessConfig(),
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

    const settledEvents = await processEvents(
      input.events,
      deps.eventDispatcher,
      deps.stateStore,
      deps.log,
    );

    const harnessConfigCurrent = await deps.readHarnessConfig();

    if (failures.length > 0) {
      const summary = failures.map((f) => `${f.kind}: ${f.message}`).join("; ");
      deps.log(
        `[applyState] driver failure(s) — settling without advancing applied state; returning failures: ${summary}`,
      );
      return {
        status: "ok",
        appliedVersion: local.lastAppliedVersion,
        appliedHash: local.lastAppliedHash,
        failures,
        settledEvents,
        harnessConfigCurrent,
      };
    }

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
      harnessConfigCurrent,
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
