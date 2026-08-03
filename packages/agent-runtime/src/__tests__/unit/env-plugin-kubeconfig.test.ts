import { describe, it, expect } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import { createEnvPlugin } from "../../modules/runtime-channel/drivers/env-plugin.js";
import type { EnvStateStore } from "../../modules/runtime-channel/infrastructure/env-state-store.js";

const ctx: DispatchContext = {
  agentHome: "/home/agent",
  pluginStateDir: "/home/agent/.platform",
  log: () => {},
};

async function applyEnv(contributions: Contribution[]) {
  let value: Record<string, string> = {};
  const store: EnvStateStore = {
    current: () => value,
    write: (env) => {
      value = env;
    },
    ready: () => true,
  };
  const handler = createEnvPlugin({ store }).bind!("env", { impl: "env" });
  await handler(contributions, ctx);
  return value;
}

function env(name: string, placeholder: string): Contribution {
  return { kind: "env", name, placeholder };
}

describe("env driver KUBECONFIG fan-in", () => {
  it("joins multiple KUBECONFIG paths and expands $HOME", async () => {
    const out = await applyEnv([
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
      env("KUBECONFIG", "$HOME/.kube/connections/b.config"),
    ]);
    expect(out.KUBECONFIG).toBe(
      "/home/agent/.kube/connections/a.config:/home/agent/.kube/connections/b.config",
    );
  });

  it("dedupes repeated paths", async () => {
    const out = await applyEnv([
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
    ]);
    expect(out.KUBECONFIG).toBe("/home/agent/.kube/connections/a.config");
  });

  it("still first-wins for ordinary env vars", async () => {
    const out = await applyEnv([
      env("GH_TOKEN", "first"),
      env("GH_TOKEN", "second"),
    ]);
    expect(out.GH_TOKEN).toBe("first");
  });
});
