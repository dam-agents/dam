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

      if (input.version <= local.lastAppliedVersion) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `stale apply: incoming version=${input.version} <= lastApplied=${local.lastAppliedVersion}`,
        });
      }

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
