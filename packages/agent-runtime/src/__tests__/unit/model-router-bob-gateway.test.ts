/**
 * TEST_OVERVIEW: Bob's calls to its own gateway beyond model calls and the
 * model list: the Model Router forwards a Bob-harness call it has no route
 * for to the Bob Shell Connection's gateway with that Connection's credential
 * placeholder, keeps Bob's own headers, streams the reply back, rewrites the
 * profile Bob reads its team from (no `region_domain`, the pinned team and
 * instance first), records no call for it, and without a Bob Shell
 * Connection answers 404 and logs the path once.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EnvLayer } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";
import {
  composeModelRouter,
  HARNESS_HEADER,
  rewriteBobProfile,
  SESSION_HEADER,
  type ModelCallRecord,
  type ModelRouter,
} from "../../modules/model-router/index.js";

const HARNESSES: Record<string, ModelRouterBinding> = {
  bob: {
    dialects: ["openai-chat"],
    modelFromSession: true,
    bobGateway: true,
  },
  "claude-code": { dialects: ["anthropic-messages"], namePrefix: "claude/" },
};

const PROFILE = {
  user_id: "user-1",
  instances: [
    {
      instance_id: "inst-1",
      region_domain: "us-east.bob.ibm.com",
      is_internal: true,
      teams: [
        { id: "team-A", name: "A", budget_limit: 100, usage: 1 },
        { id: "team-B", name: "B", budget_limit: 100, usage: 2 },
      ],
    },
    {
      instance_id: "inst-2",
      region_domain: "eu-de.bob.ibm.com",
      teams: [{ id: "team-C", name: "C", budget_limit: 50, usage: 0 }],
    },
  ],
};

const calls: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}[] = [];
const logs: string[] = [];
const recorded: ModelCallRecord[] = [];
let gateway: Server;
let layers: EnvLayer[] = [];
let router: ModelRouter;

const bobLayer = (pins: Record<string, string>, base: string): EnvLayer => ({
  id: "conn-bob",
  template: "bob",
  env: {
    BOB_DEFAULT_GATEWAY_URL: `${base}/`,
    BOBSHELL_API_KEY: "platform:conn:conn-bob",
    ...pins,
  },
});

beforeAll(async () => {
  gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    calls.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    if (req.method === "GET" && req.url === "/admin/v1/profile") {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-bob-gateway": "profile",
      });
      res.end(JSON.stringify(PROFILE));
      return;
    }
    if (req.url?.startsWith("/admin/v1/teams/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ budget_limit: 100, usage: 3 }));
      return;
    }
    if (req.method === "POST" && req.url === "/rag/v1/search?x=1") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n');
      setTimeout(() => {
        res.write('event: message\ndata: {"done":true}\n\n');
        res.end();
      }, 20);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown path" }));
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const addr = gateway.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  layers = [bobLayer({ BOB_TEAM_ID: "team-B" }, base)];
  router = composeModelRouter({
    catalog: { providers: () => [], forHarness: () => [] },
    envState: () => ({ env: {}, harnesses: [], providers: layers }),
    harnesses: HARNESSES,
    defaultHarness: "bob",
    onCall: (record) => recorded.push(record),
    port: 0,
    log: (msg) => logs.push(msg),
  });
  await router.listen();
});

afterAll(async () => {
  await router.close();
  gateway.close();
});

const bobHeaders = {
  authorization: "apikey platform:conn:router",
  "user-agent": "BobShell/2.0.9",
  "x-team-id": "team-B",
  [SESSION_HEADER]: "session-1",
};

describe("Bob's gateway calls through the router", () => {
  /** TEST_SCENARIO: Bob reads its profile from the router's base URL. The
   * router forwards the call to the Bob Shell Connection's gateway with the
   * Connection's placeholder in Bob's `Apikey` form, keeps Bob's own
   * headers, drops the platform stamps, and hands back the gateway's reply
   * with the pinned team first in the instance that holds it and no
   * `region_domain`, so Bob runs on that team and stays on the router. */
  it("forwards the profile with the Connection's placeholder and rewrites it", async () => {
    const r = await fetch(`${router.baseUrl}/admin/v1/profile`, {
      headers: bobHeaders,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-bob-gateway")).toBe("profile");
    const seen = calls.at(-1)!;
    expect(seen.method).toBe("GET");
    expect(seen.url).toBe("/admin/v1/profile");
    expect(seen.headers.authorization).toBe("Apikey platform:conn:conn-bob");
    expect(seen.headers["user-agent"]).toBe("BobShell/2.0.9");
    expect(seen.headers["x-team-id"]).toBe("team-B");
    expect(seen.headers[SESSION_HEADER]).toBeUndefined();
    expect(seen.headers[HARNESS_HEADER]).toBeUndefined();
    const profile = (await r.json()) as typeof PROFILE;
    expect(profile.user_id).toBe("user-1");
    expect(profile.instances.map((i) => i.instance_id)).toEqual([
      "inst-1",
      "inst-2",
    ]);
    expect(profile.instances[0]!.teams.map((t) => t.id)).toEqual([
      "team-B",
      "team-A",
    ]);
    expect(profile.instances[0]!.is_internal).toBe(true);
    expect(profile.instances.some((i) => "region_domain" in i)).toBe(false);
    expect(recorded).toHaveLength(0);
  });

  /** TEST_SCENARIO: Bob's docs search is an MCP client posting JSON to
   * `/rag/v1/search` and reading an event stream back. The router forwards
   * the body and the query string and streams the reply through as it
   * arrives, with the gateway's content type. */
  it("streams a docs-search reply through", async () => {
    const r = await fetch(`${router.baseUrl}/rag/v1/search?x=1`, {
      method: "POST",
      headers: { ...bobHeaders, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    const text = await r.text();
    expect(text).toContain('"jsonrpc":"2.0","id":1');
    expect(text).toContain('"done":true');
    const seen = calls.at(-1)!;
    expect(seen.url).toBe("/rag/v1/search?x=1");
    expect(JSON.parse(seen.body)).toMatchObject({ method: "initialize" });
    expect(seen.headers["content-type"]).toBe("application/json");
    expect(recorded).toHaveLength(0);
  });

  /** TEST_SCENARIO: a path under Bob's `/inference` namespace is a model
   * call, which the router serves or refuses itself: one it does not serve
   * gets its 404 rather than leaving for the gateway with no session stamp
   * and no record, since the gateway meter would bill it. */
  it("keeps an unserved model-namespace path as its own 404", async () => {
    const before = calls.length;
    const r = await fetch(`${router.baseUrl}/inference/v1/embeddings`, {
      method: "POST",
      headers: { ...bobHeaders, "content-type": "application/json" },
      body: JSON.stringify({ model: "bob/premium", input: "x" }),
    });
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(before);
    expect(
      logs.filter((l) => l.includes("bob: no route for POST /v1/embeddings")),
    ).toHaveLength(1);
  });

  /** TEST_SCENARIO: the gateway's own refusal of a forwarded call, such as a
   * 402 for a key with no team, comes back as sent and its reason lands in
   * the router's log, so the cause reads from the log alone. */
  it("relays a gateway refusal and logs its reason", async () => {
    const r = await fetch(`${router.baseUrl}/admin/v1/nowhere`, {
      headers: bobHeaders,
    });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "unknown path" });
    expect(
      logs.filter((l) =>
        l.includes(
          'bob gateway GET /admin/v1/nowhere → 404: {"error":"unknown path"}',
        ),
      ),
    ).toHaveLength(1);
  });

  /** TEST_SCENARIO: a call stamped with another harness is not Bob's, so an
   * unknown path of it is not sent to Bob's gateway; it gets the router's
   * 404 and one log line naming the harness and the path. */
  it("does not forward another harness's unknown path", async () => {
    const before = calls.length;
    const r = await fetch(`${router.baseUrl}/admin/v1/profile`, {
      headers: { [HARNESS_HEADER]: "claude-code" },
    });
    expect(r.status).toBe(404);
    expect(calls).toHaveLength(before);
    expect(
      logs.filter((l) =>
        l.includes("claude-code: no route for GET /admin/v1/profile"),
      ),
    ).toHaveLength(1);
  });

  /** TEST_SCENARIO: with no Bob Shell Connection granted, Bob's admin and
   * rag calls have nowhere to go: the router answers 404, and logs the path
   * once however often Bob retries it. */
  it("answers 404 once logged when no Bob Shell Connection is granted", async () => {
    const saved = layers;
    layers = [];
    try {
      const before = calls.length;
      const first = await fetch(`${router.baseUrl}/rag/v1/search`, {
        method: "POST",
        headers: bobHeaders,
        body: "{}",
      });
      const second = await fetch(`${router.baseUrl}/rag/v1/search`, {
        method: "POST",
        headers: bobHeaders,
        body: "{}",
      });
      expect([first.status, second.status]).toEqual([404, 404]);
      expect(
        ((await first.json()) as { error: { message: string } }).error.message,
      ).toContain("no route for POST /rag/v1/search");
      expect(calls).toHaveLength(before);
      expect(
        logs.filter((l) => l.includes("bob: no route for POST /rag/v1/search")),
      ).toHaveLength(1);
    } finally {
      layers = saved;
    }
  });
});

describe("the forwarded profile", () => {
  const text = JSON.stringify(PROFILE);
  const instancesOf = (out: string) =>
    (JSON.parse(out) as typeof PROFILE).instances;

  /** TEST_SCENARIO: a pinned instance moves first even when the pinned team
   * sits in another instance, since Bob takes the first instance's first
   * team; the pinned team still moves first within its own instance. */
  it("puts the pinned instance before the pinned team's instance", () => {
    const out = instancesOf(
      rewriteBobProfile(text, { teamId: "team-B", instanceId: "inst-2" }),
    );
    expect(out.map((i) => i.instance_id)).toEqual(["inst-2", "inst-1"]);
    expect(out[1]!.teams.map((t) => t.id)).toEqual(["team-B", "team-A"]);
  });

  /** TEST_SCENARIO: a pin that names no team or instance of the profile
   * leaves the order as the gateway sent it, so a stale pin cannot hide the
   * key's own teams. */
  it("keeps the gateway's order for an unknown pin", () => {
    const out = instancesOf(
      rewriteBobProfile(text, { teamId: "team-Z", instanceId: "inst-9" }),
    );
    expect(out.map((i) => i.instance_id)).toEqual(["inst-1", "inst-2"]);
    expect(out[0]!.teams.map((t) => t.id)).toEqual(["team-A", "team-B"]);
    expect(out.some((i) => "region_domain" in i)).toBe(false);
  });

  /** TEST_SCENARIO: a reply that is not a profile, such as an error body or
   * plain text, passes unchanged. */
  it("passes a non-profile body unchanged", () => {
    expect(
      rewriteBobProfile("not json", { teamId: "t", instanceId: null }),
    ).toBe("not json");
    const error = JSON.stringify({ error: "expired" });
    expect(rewriteBobProfile(error, { teamId: "t", instanceId: null })).toBe(
      error,
    );
  });
});
