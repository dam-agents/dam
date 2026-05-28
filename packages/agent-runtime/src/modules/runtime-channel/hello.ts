import type {
  ApplyStateInput,
  Capabilities,
  RuntimeChannelService,
} from "agent-runtime-api";
import type { HarnessClient } from "./harness-client.js";
import type { StateStore } from "./state-store.js";

export async function runHello(opts: {
  client: HarnessClient;
  stateStore: StateStore;
  runtime: RuntimeChannelService;
  capabilities: Capabilities;
  agentRuntimeVersion: string;
  log: (msg: string) => void;
}): Promise<void> {
  const local = opts.stateStore.read();
  opts.log(
    `[runtime] hello → local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} capabilities={contributions:${opts.capabilities.contributions.join("|")}, events:${opts.capabilities.events.join("|")}}`,
  );
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
      opts.log(`[runtime] hello returned events without a version; skipping`);
    } else {
      opts.log(
        `[runtime] hello: server has no state to push (outbox empty or already in sync)`,
      );
    }
    return;
  }

  opts.log(
    `[runtime] hello returned v=${result.version} hash=${result.state.hash.slice(0, 8)} contribs=${result.state.contributions.length} events=${result.events.length}; applying`,
  );
  try {
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
