import type {
  ApplyStateInput,
  Capabilities,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { HarnessClient } from "./harness-client.js";
import type { StateStore } from "./state-store.js";

/**
 * Boot/wake catch-up (ADR-052). The agent calls `runtime.v1.hello` with its
 * `lastAppliedVersion` + `lastAppliedHash` + capabilities; the server
 * returns the current state-builder envelope if anything diverged.
 *
 * On a non-empty response, this runs the same applyState path the worker
 * would have run — so `hello` and worker dispatch are interchangeable
 * delivery routes from the agent's perspective.
 */
export async function runHello(opts: {
  client: HarnessClient;
  stateStore: StateStore;
  runtime: RuntimeChannelService;
  capabilities: Capabilities;
  agentRuntimeVersion: string;
  log: (msg: string) => void;
}): Promise<void> {
  const local = opts.stateStore.read();
  let result;
  try {
    result = await opts.client.runtime.v1.hello.mutate({
      lastAppliedVersion: local.lastAppliedVersion || undefined,
      lastAppliedHash: local.lastAppliedHash ?? undefined,
      protocolVersion: "v1",
      agentRuntimeVersion: opts.agentRuntimeVersion,
      capabilities: opts.capabilities,
    });
  } catch (err) {
    opts.log(`[runtime] hello failed: ${(err as Error).message}`);
    return;
  }

  if (!result.version || !result.state) {
    if (result.events.length > 0) {
      // Edge case: server returned events but no state-version. Shouldn't
      // happen — log and skip rather than process out of order.
      opts.log(`[runtime] hello returned events without a version; skipping`);
    }
    return;
  }

  try {
    // tRPC client's response inference creates a structurally-equal but
    // nominally-distinct StateSlice / Event type. Same wire shape — cast.
    const apply: ApplyStateInput = {
      version: result.version,
      state: result.state,
      events: result.events,
    } as unknown as ApplyStateInput;
    await opts.runtime.applyState(apply);
  } catch (err) {
    opts.log(`[runtime] hello apply failed: ${(err as Error).message}`);
  }
}
