import { TRPCError } from "@trpc/server";
import type {
  ApplyStateInput,
  ApplyStateResult,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { Dispatcher } from "./dispatcher.js";
import type { StateStore } from "./state-store.js";
import type { TriggerImpl } from "./drivers/trigger-impl.js";
import { processEvents } from "./event-loop.js";

export interface ApplyStateDeps {
  dispatcher: Dispatcher;
  stateStore: StateStore;
  triggerImpl: TriggerImpl;
  log: (msg: string) => void;
}

export function createRuntimeChannelService(
  deps: ApplyStateDeps,
): RuntimeChannelService {
  return {
    async applyState(input: ApplyStateInput): Promise<ApplyStateResult> {
      const local = deps.stateStore.read();
      const kindCounts = countByKind(input.state.contributions);
      const eventCounts = countEventKinds(input.events);
      deps.log(
        `[applyState] incoming v=${input.version} hash=${input.state.hash.slice(0, 8)} local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} contribs={${kindCounts}} events={${eventCounts}}`,
      );

      if (input.version <= local.lastAppliedVersion) {
        deps.log(
          `[applyState] stale — incoming v=${input.version} <= local v=${local.lastAppliedVersion}; rejecting`,
        );
        throw new TRPCError({
          code: "CONFLICT",
          message: `stale apply: incoming version=${input.version} <= lastApplied=${local.lastAppliedVersion}`,
        });
      }

      if (input.state.hash !== local.lastAppliedHash) {
        deps.log(
          `[applyState] hash changed (${(local.lastAppliedHash ?? "<none>").slice(0, 8)} → ${input.state.hash.slice(0, 8)}); dispatching ${input.state.contributions.length} contribution(s)`,
        );
        const failures = await deps.dispatcher.apply(input.state.contributions);
        if (failures.length > 0) {
          // Fail loud: do NOT advance state-store or return success.
          // The agent's `lastAppliedVersion` stays at the previous value
          // so the *next* applyState (sweep re-enqueue or fresh state
          // change) re-runs the dispatcher with the same payload. The
          // worker on the server side catches this and refuses to stamp
          // ack, so the outbox row also keeps re-enqueueing until the
          // failure clears.
          const summary = failures
            .map((f) => `${f.kind}: ${f.message}`)
            .join("; ");
          deps.log(
            `[applyState] driver failure(s) — refusing to advance state. failures: ${summary}`,
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `apply failed for ${failures.length} driver(s): ${summary}`,
          });
        }
      } else {
        deps.log(`[applyState] hash unchanged; skipping dispatch`);
      }

      await processEvents(
        input.events,
        deps.triggerImpl,
        deps.stateStore,
        deps.log,
      );

      const next = {
        lastAppliedVersion: input.version,
        lastAppliedHash: input.state.hash,
      };
      deps.stateStore.write(next);
      deps.log(
        `[applyState] applied v=${next.lastAppliedVersion} hash=${next.lastAppliedHash.slice(0, 8)}`,
      );

      return {
        appliedVersion: next.lastAppliedVersion,
        appliedHash: next.lastAppliedHash,
      };
    },
  };
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
