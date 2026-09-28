import type {
  ApplyStateInput,
  ApplyStateResult,
  DriverFailure,
  Event,
  EventReportInput,
  HarnessConfigCurrent,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { Dispatcher, EventDispatcher } from "./dispatcher.js";
import type { StateStore } from "./state-store.js";
import { processEvents } from "./event-loop.js";

export interface ApplyStateDeps {
  dispatcher: Dispatcher;
  eventDispatcher: EventDispatcher;
  stateStore: StateStore;
  readHarnessConfig: () => Promise<HarnessConfigCurrent | undefined>;
  onSnapshotProcessed?: (
    contributions: ApplyStateInput["state"]["contributions"],
  ) => void;
  reporter: { report(input: EventReportInput): Promise<void> };
  log: (msg: string) => void;
}

export function createRuntimeChannelService(
  deps: ApplyStateDeps,
): RuntimeChannelService {
  const reportWorkspaceFailure = async (event: Event, message: string) => {
    try {
      await deps.reporter.report({
        eventId: event.id,
        outcome: "failed",
        detail: message.slice(0, 2000),
      });
    } catch (err) {
      deps.log(
        `[runtime] failure report for ${event.id} did not send: ${(err as Error).message}`,
      );
    }
  };
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
    const eventCounts = countByKind(input.events);
    deps.log(
      `[applyState] incoming v=${input.version} hash=${input.state.hash.slice(0, 8)} local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} contribs={${kindCounts}} events={${eventCounts}}`,
    );

    if (input.version < local.lastAppliedVersion) {
      deps.log(
        `[applyState] contributions stale — incoming v=${input.version} < local v=${local.lastAppliedVersion}; events only`,
      );
      const settledEvents = await processEvents(
        input.events,
        deps.eventDispatcher,
        deps.stateStore,
        deps.log,
        reportWorkspaceFailure,
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
      reportWorkspaceFailure,
    );

    const harnessConfigCurrent = await deps.readHarnessConfig();
    deps.onSnapshotProcessed?.(input.state.contributions);

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

function countByKind(items: readonly { kind: string }[]): string {
  const counts = new Map<string, number>();
  for (const c of items) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  if (counts.size === 0) return "empty";
  return Array.from(counts.entries())
    .map(([k, n]) => `${k}=${n}`)
    .join(",");
}
