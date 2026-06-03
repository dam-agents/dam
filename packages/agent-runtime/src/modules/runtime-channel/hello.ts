import type { Capabilities } from "agent-runtime-api";
import type { HarnessClient } from "./harness-client.js";
import type { StateStore } from "./state-store.js";

/** Boot/wake registration. The worker drives any actual apply. Returns whether it landed. */
export async function runHello(opts: {
  client: HarnessClient;
  stateStore: StateStore;
  capabilities: Capabilities;
  agentRuntimeVersion: string;
  log: (msg: string) => void;
}): Promise<boolean> {
  const local = opts.stateStore.read();
  opts.log(
    `[runtime] hello → local v=${local.lastAppliedVersion} hash=${(local.lastAppliedHash ?? "<none>").slice(0, 8)} capabilities={contributions:${opts.capabilities.contributions.join("|")}, events:${opts.capabilities.events.join("|")}}`,
  );
  try {
    await opts.client.runtime.v1.hello.mutate({
      lastAppliedVersion: local.lastAppliedVersion || undefined,
      lastAppliedHash: local.lastAppliedHash ?? undefined,
      protocolVersion: "v1",
      agentRuntimeVersion: opts.agentRuntimeVersion,
      capabilities: opts.capabilities,
    });
    return true;
  } catch (err) {
    opts.log(`[runtime] hello failed: ${(err as Error).message}`);
    return false;
  }
}
