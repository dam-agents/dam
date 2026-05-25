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

/**
 * The agent-side `runtime.v1.applyState` handler (ADR-052). Reconciles
 * contributions through the dispatcher and processes events through the
 * event loop. Persists the new cursor before responding so a crash after
 * ack doesn't re-trigger reconciliation on next boot.
 *
 * The handler is the only writer to the agent's local cursor. The api-server
 * worker stamps the server-side cursor on the apply-ack.
 */
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

      // Stale push — older version arrived after a newer one (race between
      // replicas dispatching). Reject loud so the worker logs and stops
      // retrying.
      if (input.version <= local.lastAppliedVersion) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `stale apply: incoming version=${input.version} <= lastApplied=${local.lastAppliedVersion}`,
        });
      }

      // Short-circuit: if the hash matches the last applied, skip
      // contribution reconciliation. Events still get processed because
      // they're keyed off `version`, not `hash`.
      if (input.state.hash !== local.lastAppliedHash) {
        await deps.dispatcher.apply(input.state.contributions);
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

      return {
        appliedVersion: next.lastAppliedVersion,
        appliedHash: next.lastAppliedHash,
      };
    },
  };
}
