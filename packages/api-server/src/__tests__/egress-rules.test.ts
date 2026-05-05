import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ApprovalView } from "api-server-api";
import { client } from "./helpers/trpc-client.js";
import { execInPod, waitForPodReady } from "./helpers/kubectl.js";

/**
 * End-to-end tests for the network-access enforcement path
 * (ADR-035). Each test exercises the real agent pod's Envoy
 * sidecar and the api-server's ext_authz gate against a host the test
 * fully owns: the agent is created with the `none` preset and zero
 * connection-derived rules, so observed allow/deny is unambiguously
 * caused by the rule the test under inspection just wrote (or didn't).
 *
 * `example.com` and `neverssl.com` are public, stable, and serve both
 * HTTP and HTTPS — they're the simplest way to assert "Envoy actually
 * forwarded the bytes upstream" without depending on internal services.
 *
 * The hold deadline (`approvalHoldSeconds`, default 1800s) outlasts the
 * test, but we only check that a `pending_approvals` row appears — the
 * row is allowed to remain pending; we don't wait for it to expire.
 */

let AGENT_ID: string;
let INSTANCE_ID: string;
let POD_NAME: string;

beforeAll(async () => {
  const agent = await client.agents.create.mutate({
    name: "egress-test",
    templateId: "claude-code",
    egressPreset: "none",
  });
  AGENT_ID = agent.id;
  // The Envoy sidecar (and therefore the entire ext_authz enforcement
  const inst = await client.instances.create.mutate({
    name: "egress-test-inst",
    agentId: AGENT_ID,
  });
  INSTANCE_ID = inst.id;
  POD_NAME = `${INSTANCE_ID}-0`;
  await waitForPodReady(POD_NAME, 240_000);

  // Warm-up: pod ready ≠ ext_authz pipeline ready. The api-server
  // resolves instance → agent identity lazily on the first Check call,
  // and the cold lookup after pod creation can leave the first
  // request's gate call returning deny without inserting a pending row.
  // Issue one curl, drain any approvals, then start asserting.
  curl("example.com", "https");
  await new Promise((r) => setTimeout(r, 500));
  await dismissAllApprovals();
});

afterAll(async () => {
  try {
    await client.instances.delete.mutate({ id: INSTANCE_ID });
  } catch {}
  try {
    await client.agents.delete.mutate({ id: AGENT_ID });
  } catch {}
});

/** Revoke every active rule for the test agent so each test starts from a
 *  clean default-deny posture. Cheaper and more deterministic than
 *  recreating the agent between tests (which would re-roll the heavy
 *  claude-code pod). */
async function clearAllRules() {
  const rules = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
  for (const r of rules) {
    await client.egressRules.revoke.mutate({ id: r.id });
  }
}

/** Resolve every pending approval the test agent is holding so the next
 *  test's "no pending row" assertion is meaningful. `dismiss` writes no
 *  rule, so it's the right cleanup verb here. */
async function dismissAllApprovals() {
  const rows = await client.approvals.listForInstance.query({
    instanceId: INSTANCE_ID,
    status: "pending",
  });
  for (const r of rows) {
    try {
      await client.approvals.dismiss.mutate({ id: r.id });
    } catch {}
  }
}

afterEach(async () => {
  await clearAllRules();
  await dismissAllApprovals();
});

function curl(host: string, scheme: "http" | "https", timeoutSec = 4) {
  // -s: silent; -o /dev/null: discard body; -w "%{http_code}": print status;
  // --max-time: bound the wait so a held request doesn't stall the test.
  // -k: skip cert validation. The agent image trusts only the platform's internal
  // CA (`/etc/platform/ca/ca.crt`), which doesn't sign real upstream certs,
  // so on the L4 SNI-passthrough path curl would otherwise fail with
  // CURLE_SSL_CACERT (77) even when the gate allowed the request. We're
  // testing gate enforcement, not TLS validation — `-k` decouples them.
  return execInPod(POD_NAME, "agent", [
    "curl",
    "-sSk",
    "-o", "/dev/null",
    "-w", "%{http_code}",
    "--max-time", String(timeoutSec),
    `${scheme}://${host}/`,
  ], { timeoutMs: (timeoutSec + 5) * 1000 });
}

/** Poll for a pending approval matching `host`. The api-server resolves
 *  the instance → agent identity asynchronously after the pod becomes
 *  Ready, so the first ext_authz Check after pod startup can race that
 *  resolution and return deny without inserting a pending row. Retrying
 *  for a few seconds is enough — once the resolution lands, every
 *  subsequent Check inserts immediately. */
async function findPendingForHost(
  host: string,
  timeoutMs = 5_000,
): Promise<ApprovalView | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await client.approvals.listForInstance.query({
      instanceId: INSTANCE_ID,
      status: "pending",
    });
    const found = rows.find(
      (r) => r.payload.kind === "ext_authz" && r.payload.host === host,
    );
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

describe("egress rules: enforcement", () => {
  describe("HTTPS — L4 path (host-only rules)", () => {
    it("default-deny: curl https://example.com hangs and creates a pending approval", async () => {
      const before = (await client.egressRules.listForAgent.query({ agentId: AGENT_ID })).length;
      expect(before).toBe(0);

      const res = curl("example.com", "https");
      // Held by the gate; curl gives up at --max-time. Exit 28 = timeout.
      // Anything other than 0 or 28 (e.g. 7 connection-refused) would mean
      // the proxy itself rejected, which is also defensible — but we
      // additionally assert the pending row was written.
      expect(res.exitCode).not.toBe(0);

      const pending = await findPendingForHost("example.com");
      expect(pending).toBeDefined();
    });

    it("an allow rule lets the request through", async () => {
      await client.egressRules.create.mutate({
        agentId: AGENT_ID,
        host: "example.com",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
      });

      // Wildcard rules are read on every request — no pod roll needed.
      const res = curl("example.com", "https", 10);
      expect(res.exitCode).toBe(0);
      // example.com returns 200; if the assertion ever flakes the upstream
      // changed, but we'd still want to fail because that's an upstream-
      // specific signal worth seeing.
      expect(res.stdout).toBe("200");
    });

    it("a deny rule blocks the request without prompting", async () => {
      await client.egressRules.create.mutate({
        agentId: AGENT_ID,
        host: "example.com",
        method: "*",
        pathPattern: "*",
        verdict: "deny",
      });

      const res = curl("example.com", "https");
      expect(res.exitCode).not.toBe(0);

      // Deny rule short-circuits the gate before insertPending fires.
      const pending = await findPendingForHost("example.com");
      expect(pending).toBeUndefined();
    });
  });

  describe("plain HTTP — outer-HCM L7 path", () => {
    it("default-deny: curl http://example.com hangs and creates a pending approval", async () => {
      const res = curl("example.com", "http");
      expect(res.exitCode).not.toBe(0);

      const pending = await findPendingForHost("example.com");
      expect(pending).toBeDefined();
      // Plain HTTP carries full L7 attributes from the request line —
      // method/path are populated even though we don't have a TLS-
      // terminating chain for this host.
      if (pending && pending.payload.kind === "ext_authz") {
        expect(pending.payload.method).toBe("GET");
        expect(pending.payload.path).toBe("/");
      }
    });

    it("an allow rule lets the plain HTTP request through", async () => {
      await client.egressRules.create.mutate({
        agentId: AGENT_ID,
        host: "example.com",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
      });

      const res = curl("example.com", "http", 10);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe("200");
    });
  });

  describe("rule lifecycle is reflected immediately", () => {
    it("revoking the allow rule re-engages default-deny on the next request", async () => {
      const created = await client.egressRules.create.mutate({
        agentId: AGENT_ID,
        host: "example.com",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
      });
      // Confirm the rule is in effect.
      const allow = curl("example.com", "https", 10);
      expect(allow.exitCode).toBe(0);

      // Revoke and re-curl — the L4 gate reads the DB on every request,
      // so the change takes effect without any pod / Envoy reload.
      await client.egressRules.revoke.mutate({ id: created.id });
      const denied = curl("example.com", "https");
      expect(denied.exitCode).not.toBe(0);
    });
  });

  describe("preset switching", () => {
    it("applying `trusted` seeds preset:trusted rows; switching to `none` revokes them", async () => {
      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "trusted" });

      const seeded = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      expect(seeded.length).toBeGreaterThan(0);
      // Every seeded row carries the preset:trusted source.
      for (const r of seeded) {
        expect(r.source).toBe("preset:trusted");
      }
      // Anthropic API host is canonical for this preset; if the helm
      // values change, this assertion is a heads-up to the operator.
      const apiAnthropic = seeded.find((r) => r.host === "api.anthropic.com");
      expect(apiAnthropic).toBeDefined();

      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "none" });
      const swept = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      expect(swept.filter((r) => r.source.startsWith("preset:")).length).toBe(0);
    });

    it("connection grant promotes a preset:* row so a later preset switch keeps it", async () => {
      // Both intents target api.anthropic.com:
      //   - preset:trusted seeds (anthropic, *, *, allow, source=preset:trusted)
      //   - the granted Anthropic secret seeds (anthropic, *, *, allow,
      //     source=connection:<id>)
      // The unique index on (agent, host, *, *) WHERE active permits only
      // one. Without promotion, the connection insert silently no-ops and
      // a later preset switch wipes the host even though the user still
      // has the grant.
      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "trusted" });
      const presetSeeded = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      const beforeGrant = presetSeeded.find((r) => r.host === "api.anthropic.com");
      expect(beforeGrant?.source).toBe("preset:trusted");

      // Pick any Anthropic-typed secret the test environment exposes;
      // skip cleanly if the test cluster doesn't seed one.
      const secrets = await client.secrets.list.query();
      const anthropic = secrets.find((s) => s.type === "anthropic");
      if (!anthropic) return;
      await client.secrets.setAgentAccess.mutate({
        agentId: AGENT_ID,
        mode: "selective",
        secretIds: [anthropic.id],
      });

      const afterGrant = (await client.egressRules.listForAgent.query({ agentId: AGENT_ID }))
        .find((r) => r.host === "api.anthropic.com");
      expect(afterGrant?.source).toBe(`connection:${anthropic.id}`);

      // Switching the preset off should NOT take down the host — the row
      // is now connection-owned, not preset:*.
      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "none" });
      const afterSwitch = (await client.egressRules.listForAgent.query({ agentId: AGENT_ID }))
        .find((r) => r.host === "api.anthropic.com");
      expect(afterSwitch?.source).toBe(`connection:${anthropic.id}`);

      // Cleanup: revoke the grant so subsequent tests start without it.
      await client.secrets.setAgentAccess.mutate({
        agentId: AGENT_ID,
        mode: "selective",
        secretIds: [],
      });
    });

    it("switching presets does not touch manual rules", async () => {
      const manual = await client.egressRules.create.mutate({
        agentId: AGENT_ID,
        host: "manual-host.example",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
      });

      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "trusted" });
      await client.egressRules.applyPreset.mutate({ agentId: AGENT_ID, preset: "none" });

      const after = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      const stillThere = after.find((r) => r.id === manual.id);
      expect(stillThere).toBeDefined();
      expect(stillThere?.source).toBe("manual");
    });
  });

  describe("inbox actions", () => {
    it("dismiss resolves the held call without writing a rule", async () => {
      // Trigger a hold by issuing a curl to an unruled host. We don't wait
      // for it — the `--max-time` lets it return; the pending row is what
      // we care about.
      curl("example.com", "https");

      const pending = await findPendingForHost("example.com");
      expect(pending).toBeDefined();
      const beforeRules = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });

      await client.approvals.dismiss.mutate({ id: pending!.id });

      // No rule should have been written by the dismiss path.
      const afterRules = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      expect(afterRules.length).toBe(beforeRules.length);

      // The next request to the same host should re-prompt (verified by
      // a fresh pending row whose id is different from the one we dismissed).
      curl("example.com", "https");
      const newPending = await findPendingForHost("example.com");
      expect(newPending).toBeDefined();
      expect(newPending!.id).not.toBe(pending!.id);
    });

    it("denyForever resolves the held call AND writes a deny rule", async () => {
      curl("example.com", "https");
      const pending = await findPendingForHost("example.com");
      expect(pending).toBeDefined();

      await client.approvals.denyForever.mutate({ id: pending!.id });

      const rules = await client.egressRules.listForAgent.query({ agentId: AGENT_ID });
      const denyRule = rules.find(
        (r) => r.host === "example.com" && r.verdict === "deny" && r.source === "inbox",
      );
      expect(denyRule).toBeDefined();

      // Subsequent request matches the deny rule — short-circuited, no
      // new pending row.
      curl("example.com", "https");
      const stillNoPending = await findPendingForHost("example.com");
      expect(stillNoPending).toBeUndefined();
    });
  });
});
