// TEST_OVERVIEW: What the gate knows of whether an Environment endpoint's app is ready. A "not ready" is kept for a few seconds, so many requests cost one probe, and probes asked for at once share one; a "ready" is kept until a relay fails to connect or the Environment wakes again, so a running app is never probed per request. Each endpoint, and each readiness path, is decided on its own.
import { describe, expect, it } from "vitest";
import { createEndpointReadiness } from "../../modules/environments/gate/endpoint-readiness.js";

function world() {
  let clock = 0;
  const answers = new Map<string, boolean>();
  const probed: string[] = [];
  const readiness = createEndpointReadiness({
    probe: async (t: { agentId: string; endpoint: string; ready?: string }) => {
      probed.push(`${t.agentId}/${t.endpoint}${t.ready ?? ""}`);
      if (answers.get(t.endpoint) === undefined) throw new Error("refused");
      return answers.get(t.endpoint)!;
    },
    now: () => clock,
    retryMs: 3_000,
  });
  return {
    readiness,
    answers,
    probed,
    tick: (ms: number) => (clock += ms),
  };
}

const app = { agentId: "env-1", endpoint: "app" };

describe("an endpoint's readiness", () => {
  // TEST_SCENARIO: an app not ready yet is probed once for a burst of requests, again only after the few seconds pass, and a probe that fails outright counts as not ready.
  it("keeps a not-ready answer for a few seconds", async () => {
    const w = world();

    expect(await w.readiness.ready(app)).toBe(false);
    w.tick(1_000);
    expect(await w.readiness.ready(app)).toBe(false);
    expect(w.probed).toHaveLength(1);

    w.tick(2_000);
    w.answers.set("app", true);
    expect(await w.readiness.ready(app)).toBe(true);
    expect(w.probed).toHaveLength(2);
  });

  // TEST_SCENARIO: a page that loads many assets at once asks many times before the first probe answers; they share that one probe.
  it("shares one probe among requests at once", async () => {
    const w = world();
    w.answers.set("app", true);

    const all = await Promise.all([1, 2, 3].map(() => w.readiness.ready(app)));

    expect(all).toEqual([true, true, true]);
    expect(w.probed).toHaveLength(1);
  });

  // TEST_SCENARIO: a ready app is not probed again however much time passes; a relay that finds nothing listening, or a new wake of the Environment, makes the next request probe again.
  it("keeps ready until a failed relay or a new wake", async () => {
    const w = world();
    w.answers.set("app", true);
    await w.readiness.ready(app);
    w.tick(3_600_000);
    await w.readiness.ready(app);
    expect(w.probed).toHaveLength(1);

    w.readiness.failed(app);
    await w.readiness.ready(app);
    expect(w.probed).toHaveLength(2);

    w.readiness.forget("env-1");
    await w.readiness.ready(app);
    expect(w.probed).toHaveLength(3);
  });

  // TEST_SCENARIO: two endpoints on one port, told apart by host name inside the Environment, are each decided on their own; and a readiness path set later is probed afresh rather than read from what was known without it.
  it("decides each endpoint and each readiness path on its own", async () => {
    const w = world();
    w.answers.set("app", true);
    w.answers.set("auth", false);

    expect(await w.readiness.ready(app)).toBe(true);
    expect(await w.readiness.ready({ ...app, endpoint: "auth" })).toBe(false);
    expect(await w.readiness.ready({ ...app, ready: "/healthz" })).toBe(true);
    expect(w.probed).toEqual(["env-1/app", "env-1/auth", "env-1/app/healthz"]);
  });
});
