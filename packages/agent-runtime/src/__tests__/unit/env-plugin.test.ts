import { describe, it, expect } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import {
  createEnvPlugin,
  type EnvChange,
} from "../../modules/runtime-channel/drivers/env-plugin.js";
import {
  leaseEnvOf,
  type EnvStateStore,
  type RuntimeEnvState,
} from "../../modules/runtime-channel/infrastructure/env-state-store.js";

const ctx: DispatchContext = {
  agentHome: "/home/agent",
  pluginStateDir: "/home/agent/.platform",
  log: () => {},
};

function env(
  name: string,
  placeholder: string,
  scope: { provider?: string; harness?: string } = {},
): Contribution {
  return { kind: "env", name, placeholder, ...scope };
}

function harness(initial: Record<string, string> = {}) {
  let value: RuntimeEnvState = { env: initial, providers: [], harnesses: [] };
  const changes: EnvChange[] = [];
  const forLease = (lease: {
    harness: string | null;
    provider: string | null;
  }) => leaseEnvOf(value, lease);
  const store: EnvStateStore = {
    state: () => value,
    current: () =>
      forLease({ harness: null, provider: value.providers[0]?.id ?? null }),
    providers: () => value.providers.map((p) => p.id),
    forLease,
    write: (e) => {
      value = e;
    },
    ready: () => true,
  };
  const handler = createEnvPlugin({
    store,
    onChange: (c) => changes.push(c),
  }).bind!("env", { impl: "env" });
  return {
    apply: (c: Contribution[]) => handler(c, ctx),
    env: () => value.env,
    forLease,
    changes,
  };
}

describe("env driver KUBECONFIG fan-in", () => {
  it("joins multiple KUBECONFIG paths and expands $HOME", async () => {
    const h = harness();
    await h.apply([
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
      env("KUBECONFIG", "$HOME/.kube/connections/b.config"),
    ]);
    expect(h.env().KUBECONFIG).toBe(
      "/home/agent/.kube/connections/a.config:/home/agent/.kube/connections/b.config",
    );
  });

  it("dedupes repeated paths", async () => {
    const h = harness();
    await h.apply([
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
      env("KUBECONFIG", "$HOME/.kube/connections/a.config"),
    ]);
    expect(h.env().KUBECONFIG).toBe("/home/agent/.kube/connections/a.config");
  });

  it("still first-wins for ordinary env vars", async () => {
    const h = harness();
    await h.apply([env("GH_TOKEN", "first"), env("GH_TOKEN", "second")]);
    expect(h.env().GH_TOKEN).toBe("first");
  });
});

describe("env driver change classification (#3143)", () => {
  const BASE = { GH_TOKEN: "v", PLATFORM_GH_TOKEN_AVAILABLE: "true" };

  it("a value-only change is written but reported as namesChanged: false", async () => {
    const h = harness(BASE);
    await h.apply([env("GH_TOKEN", "rotated-value")]);
    expect(h.changes).toMatchObject([{ namesChanged: false }]);
    expect(h.env().GH_TOKEN).toBe("rotated-value");
  });

  it("an added or removed variable reports namesChanged: true", async () => {
    const h = harness(BASE);
    await h.apply([env("GH_TOKEN", "v"), env("NEW_VAR", "x")]);
    expect(h.changes).toMatchObject([{ namesChanged: true }]);
  });

  it("an unchanged env fires no change at all", async () => {
    const h = harness(BASE);
    await h.apply([env("GH_TOKEN", "v")]);
    expect(h.changes).toEqual([]);
  });

  it("removing a variable named after an Object.prototype member is a set change", async () => {
    const h = harness({
      toString: "x",
      NEW_VAR: "y",
      PLATFORM_GH_TOKEN_AVAILABLE: "false",
    });
    await h.apply([env("NEW_VAR", "y"), env("OTHER", "z")]);
    expect(h.changes).toMatchObject([{ namesChanged: true }]);
  });
});

describe("env driver gh availability flag", () => {
  /** TEST_SCENARIO: One GitHub account hands the agent GH_TOKEN, or
   * GH_ENTERPRISE_TOKEN for an Enterprise Server host, and either alone says gh
   * credentials are available. */
  it("derives the flag from GH_TOKEN or GH_ENTERPRISE_TOKEN", async () => {
    const h = harness();
    await h.apply([env("GH_TOKEN", "platform:conn:aaa")]);
    expect(h.env().PLATFORM_GH_TOKEN_AVAILABLE).toBe("true");
    await h.apply([env("GH_ENTERPRISE_TOKEN", "platform:conn:ghes")]);
    expect(h.env().PLATFORM_GH_TOKEN_AVAILABLE).toBe("true");
  });

  /** TEST_SCENARIO: Several GitHub accounts replace GH_TOKEN with gh's hosts
   * file, which the env driver cannot see, so the platform states availability
   * itself and the driver keeps that statement. */
  it("keeps a delivered flag when no GH_TOKEN is present", async () => {
    const h = harness();
    await h.apply([env("PLATFORM_GH_TOKEN_AVAILABLE", "true")]);
    expect(h.env().PLATFORM_GH_TOKEN_AVAILABLE).toBe("true");
  });

  /** TEST_SCENARIO: Nothing GitHub-shaped in the snapshot reads as unavailable,
   * whatever a stale value said before. */
  it("reads false when neither GH_TOKEN nor a statement arrives", async () => {
    const h = harness({ PLATFORM_GH_TOKEN_AVAILABLE: "true" });
    await h.apply([env("OTHER", "z")]);
    expect(h.env().PLATFORM_GH_TOKEN_AVAILABLE).toBe("false");
  });
});

describe("env driver provider and harness layers", () => {
  /** TEST_SCENARIO: Two provider Connections both name the harness's base URL.
   * Each lands in its own layer, so a lease on either sees only its own, and
   * the agent-wide env carries neither. */
  it("keeps each provider's env apart from the agent-wide env and from each other", async () => {
    const h = harness();
    await h.apply([
      env("EDITOR", "vim"),
      env("ANTHROPIC_BASE_URL", "https://a.example", { provider: "conn-a" }),
      env("ANTHROPIC_BASE_URL", "https://b.example", { provider: "conn-b" }),
    ]);
    expect(h.env().ANTHROPIC_BASE_URL).toBeUndefined();
    expect(
      h.forLease({ harness: "codex", provider: "conn-a" }).ANTHROPIC_BASE_URL,
    ).toBe("https://a.example");
    expect(h.forLease({ harness: "codex", provider: "conn-b" })).toMatchObject({
      ANTHROPIC_BASE_URL: "https://b.example",
      EDITOR: "vim",
    });
  });

  /** TEST_SCENARIO: A harness's own telemetry settings reach only leases of
   * that harness: Bob given Claude Code's OTLP settings would export to its
   * vendor's endpoint. */
  it("gives a harness layer only to leases of that harness", async () => {
    const h = harness();
    await h.apply([
      env("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf", {
        harness: "claude-code",
      }),
      env("BOB_TELEMETRY_ENABLED", "true", { harness: "bob" }),
    ]);
    const bob = h.forLease({ harness: "bob", provider: null });
    expect(bob.OTEL_EXPORTER_OTLP_PROTOCOL).toBeUndefined();
    expect(bob.BOB_TELEMETRY_ENABLED).toBe("true");
  });

  /** TEST_SCENARIO: An agent created before rails were per harness still holds
   * Claude Code's rail in its own env. A variable some harness layer carries
   * belongs to the harnesses, so that older copy reaches no lease. */
  it("drops an agent-wide copy of a variable a harness layer carries", async () => {
    const h = harness();
    await h.apply([
      env("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"),
      env("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf", {
        harness: "claude-code",
      }),
      env("EDITOR", "vim"),
    ]);
    expect(h.forLease({ harness: "bob", provider: null })).toEqual(
      expect.not.objectContaining({
        OTEL_EXPORTER_OTLP_PROTOCOL: expect.anything(),
      }),
    );
    expect(
      h.forLease({ harness: "claude-code", provider: null })
        .OTEL_EXPORTER_OTLP_PROTOCOL,
    ).toBe("http/protobuf");
  });

  /** TEST_SCENARIO: Revoking one provider changes only that provider's layer,
   * so only leases on it recycle. */
  it("reports only the layer that changed", async () => {
    const h = harness();
    const a = env("OPENAI_BASE_URL", "https://a.example", {
      provider: "conn-a",
    });
    const b = env("OPENAI_BASE_URL", "https://b.example", {
      provider: "conn-b",
    });
    await h.apply([env("EDITOR", "vim"), a, b]);
    h.changes.length = 0;
    await h.apply([env("EDITOR", "vim"), a]);
    expect(h.changes).toEqual([
      expect.objectContaining({
        base: null,
        providers: [{ id: "conn-b", namesChanged: true }],
        harnesses: [],
      }),
    ]);
  });
});
