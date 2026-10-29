/**
 * TEST_OVERVIEW: People an owner shares an interactive artifact with use its
 * page as the owner does. The share page relays the page's requests and
 * prompts to the share host, which checks on every call that the visitor is
 * signed in and on the viewer list, that the call comes from the share page
 * itself, by the relay token only that page holds and by its origin, and
 * that the artifact is still interactive, restricted,
 * agent-published and has its feature on. A request reaches the publishing
 * Agent's Artifact API server; a prompt starts or continues the viewer's own
 * Session on that Agent. Every call is in the security log under the viewer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcpClient, SendPromptOpts } from "../../core/acp-client.js";
import { AcpSessionLoadError } from "../../core/acp-client.js";
import type { ShareSession } from "../../modules/artifact-library/domain/share-session.js";
import { shareSessionCookie } from "../../modules/artifact-library/domain/share-session.js";
import {
  viewerSessionKey,
  viewerSessionTitle,
} from "../../modules/artifact-library/domain/viewer-bridge.js";
import type { ArtifactRow } from "../../modules/artifact-library/infrastructure/artifact-library-repository.js";
import { createViewerPromptDelivery } from "../../modules/artifact-library/infrastructure/viewer-prompt-delivery.js";
import { createRelayTokenService } from "../../modules/artifact-library/services/relay-token-service.js";
import { createRenderTokenService } from "../../modules/artifact-library/services/render-token-service.js";
import {
  createShareBridgeService,
  type ViewerPromptDelivery,
} from "../../modules/artifact-library/services/share-bridge-service.js";
import type {
  ShareViewerService,
  SharedResolution,
} from "../../modules/artifact-library/services/share-viewer-service.js";
import {
  RELAYED_FRAME_SANDBOX,
  renderWrapper,
} from "../../modules/artifact-library/viewer/renderer.js";
import { createShareViewerApp } from "../../modules/artifact-library/viewer/viewer-app.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";

const securityLog = vi.hoisted(() => vi.fn());
vi.mock("../../core/security-log.js", () => ({ securityLog }));

const SHARE = "https://share.example.com";

function artifactRow(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: "a1",
    owner: "owner-1",
    agentId: "agent-1",
    folderId: null,
    sourcePath: null,
    title: "Team dashboard",
    slug: "slug-a",
    kind: "html",
    contentType: "text/html",
    fileName: "dashboard.html",
    storageRef: "library/owner-1/a1/v1/dashboard.html",
    sizeBytes: 64,
    version: 1,
    visibility: "restricted",
    interactive: true,
    expiresAt: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const alice: ShareSession = {
  sub: "alice-sub",
  email: "alice@example.com",
  emailVerified: true,
  createdAt: 0,
};
const bob: ShareSession = {
  ...alice,
  sub: "bob-sub",
  email: "bob@example.com",
};

const SESSIONS = new Map([
  ["sid-alice", alice],
  ["sid-alice-earlier", alice],
  ["sid-bob", bob],
]);

const relayTokens = createRelayTokenService({
  grants: createMemoryTtlStore(60_000, () => 0),
});

interface World {
  artifact: ArtifactRow;
  viewers: string[];
  featureOn: boolean;
  agentAwake: boolean;
  wakeFails: boolean;
  appRequests: { agentId: string; method: string; path: string }[];
  appCallers: unknown[];
  delivered: Parameters<ViewerPromptDelivery["deliver"]>[0][];
  deliverOutcome: "accepted" | "spend-limit" | "agent-unreachable";
}

function world(overrides: Partial<World> = {}) {
  const w: World = {
    artifact: artifactRow(),
    viewers: ["alice@example.com"],
    featureOn: true,
    agentAwake: false,
    wakeFails: false,
    appRequests: [],
    appCallers: [],
    delivered: [],
    deliverOutcome: "accepted",
    ...overrides,
  };
  const viewer: ShareViewerService = {
    resolveArtifact: () =>
      Promise.resolve(
        w.artifact.visibility === "private"
          ? { state: "not-found" }
          : w.artifact.visibility === "public"
            ? ({ state: "ok", artifact: w.artifact } satisfies SharedResolution)
            : ({
                state: "restricted",
                artifact: w.artifact,
              } satisfies SharedResolution),
      ),
    resolveFolder: () => Promise.resolve({ state: "not-found" }),
    canView: (artifact, session) =>
      Promise.resolve(
        session.sub === artifact.owner ||
          (session.email !== null && w.viewers.includes(session.email))
          ? "allow"
          : "deny",
      ),
    content: () => Promise.resolve(null),
    contentStream: () => Promise.resolve(null),
    recordView: () => {},
  };
  const bridge = createShareBridgeService({
    featureOn: () => Promise.resolve(w.featureOn),
    ensureReady: () => {
      if (w.wakeFails) return Promise.reject(new Error("did not wake"));
      w.agentAwake = true;
      return Promise.resolve();
    },
    agentApi: {
      request: (agentId, input) => {
        w.appRequests.push({ agentId, method: input.method, path: input.path });
        w.appCallers.push(input.caller);
        return Promise.resolve({
          ok: true,
          status: 200,
          contentType: "application/json",
          body: '{"live":true}',
        });
      },
    },
    prompts: {
      deliver: (input) => {
        w.delivered.push(input);
        return Promise.resolve(w.deliverOutcome);
      },
    },
  });
  const app = createShareViewerApp({
    viewer,
    auth: { getSession: (id) => Promise.resolve(SESSIONS.get(id) ?? null) },
    sessionCookie: shareSessionCookie(SHARE),
    renderTokens: createRenderTokenService({
      grants: createMemoryTtlStore(60_000, () => 0),
    }),
    relayTokens,
    brandName: "Platform",
    uiBaseUrl: "http://app.localhost",
    contentBaseUrl: "https://content.example.com",
    shareBaseUrl: SHARE,
    bridge,
  });
  return { w, app };
}

function relayTokenFor(
  sid: string,
  artifact: Pick<ArtifactRow, "id" | "version"> = artifactRow(),
) {
  return relayTokens.mint({
    artifactId: artifact.id,
    version: artifact.version,
    viewerSub: SESSIONS.get(sid)?.sub ?? "nobody",
    shareSessionId: sid,
  });
}

async function call(
  app: ReturnType<typeof world>["app"],
  path: string,
  body: unknown,
  opts: {
    sid?: string | null;
    origin?: string | null;
    token?: string | null;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const sid = opts.sid === undefined ? "sid-alice" : opts.sid;
  if (sid !== null) headers.cookie = `__Host-share_session=${sid}`;
  const origin = opts.origin === undefined ? SHARE : opts.origin;
  if (origin !== null) headers.origin = origin;
  const token =
    opts.token === undefined
      ? await relayTokenFor(sid ?? "sid-alice")
      : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app.request(path, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const getState = { method: "GET", path: "/state" };

function loggedEvents() {
  return securityLog.mock.calls.map((args: unknown[]) => {
    const [level, event, fields] = args as [string, string, object];
    return { level, event, ...fields };
  });
}

beforeEach(() => securityLog.mockClear());

describe("a viewer's request on a shared interactive page", () => {
  /**
   * TEST_SCENARIO: A teammate opens the live dashboard the owner shared with
   * them. The page reads its data from the owner's Agent; the hibernated
   * Agent wakes, and its app's answer reaches the viewer as it would the
   * owner.
   */
  it("wakes the agent and returns its app's answer", async () => {
    const { w, app } = world();
    const res = await call(app, "/a/slug-a/request", getState);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: '{"live":true}',
    });
    expect(w.agentAwake).toBe(true);
    expect(w.appRequests).toEqual([
      { agentId: "agent-1", method: "GET", path: "/state" },
    ]);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * TEST_SCENARIO: A shared survey keeps each teammate's answers apart. The
   * Agent's app learns which viewer asks from the share session, never from
   * the page, so a viewer cannot read another's answers by claiming their
   * email.
   */
  it("tells the agent's app which viewer is asking", async () => {
    const { w, app } = world();
    await call(app, "/a/slug-a/request", {
      ...getState,
      caller: { role: "owner", email: "bob@example.com" },
    });
    expect(w.appCallers).toEqual([
      { role: "viewer", email: "alice@example.com" },
    ]);
  });

  it("passes every method through", async () => {
    const { w, app } = world();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call(app, "/a/slug-a/request", {
        method,
        path: "/state",
        body: "{}",
      });
      expect(await res.json()).toMatchObject({ ok: true });
    }
    expect(w.appRequests.map((r) => r.method)).toEqual([
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
    ]);
  });

  /**
   * TEST_SCENARIO: The viewer-list check is the boundary, and it is asked on
   * every call. Someone without a share session, someone signed in but not
   * on the list, and a viewer the owner just removed are all refused before
   * any Agent wakes.
   */
  it("refuses anyone not signed in and on the viewer list, every call", async () => {
    const { w, app } = world();
    expect(
      (await call(app, "/a/slug-a/request", getState, { sid: null })).status,
    ).toBe(401);
    expect(
      (await call(app, "/a/slug-a/request", getState, { sid: "sid-bob" }))
        .status,
    ).toBe(403);
    expect((await call(app, "/a/slug-a/request", getState)).status).toBe(200);
    w.viewers.length = 0;
    const removed = await call(app, "/a/slug-a/request", getState);
    expect(removed.status).toBe(403);
    expect(await removed.json()).toEqual({ ok: false, reason: "not-allowed" });
    expect(w.appRequests).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The share session cookie rides every request a browser
   * sends to the share host, including one that code on the content host or
   * another site starts. Only a call from the share page's own origin is
   * relayed, so artifact code cannot use the viewer's session behind the
   * share page's back.
   */
  it("refuses a call that does not come from the share page's origin", async () => {
    const { w, app } = world();
    for (const origin of [
      "https://content.example.com",
      "https://evil.example",
      null,
    ]) {
      const res = await call(app, "/a/slug-a/request", getState, { origin });
      expect(res.status).toBe(403);
    }
    expect(w.appRequests).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The owner can take the page's reach away at any time: by
   * making it private, by publishing it as a plain page, or by turning
   * Interactive artifacts off. Each one stops the next call, and a page with
   * no publishing Agent never had one to reach.
   */
  it.each([
    ["private", { visibility: "private" as const }, {}, 404],
    ["not interactive", { interactive: false }, {}, 200],
    ["uploaded by a person", { agentId: null }, {}, 200],
    ["feature off", {}, { featureOn: false }, 200],
  ])(
    "refuses when the artifact is %s",
    async (_name, row, settings, status) => {
      const { w, app } = world({ artifact: artifactRow(row), ...settings });
      const res = await call(app, "/a/slug-a/request", getState);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ ok: false, reason: "not-allowed" });
      expect(w.agentAwake).toBe(false);
      expect(w.appRequests).toEqual([]);
    },
  );

  it("never relays for a public page", async () => {
    const { w, app } = world({
      artifact: artifactRow({ visibility: "public" }),
    });
    const res = await call(app, "/a/slug-a/request", getState);
    expect(res.status).toBe(404);
    expect(w.appRequests).toEqual([]);
  });

  it("answers invalid-request for a malformed request", async () => {
    const { w, app } = world();
    for (const body of [
      "not json",
      { method: "TRACE", path: "/" },
      { method: "GET", path: "no-slash" },
      { method: "GET", path: "/", body: "x" },
    ]) {
      const res = await call(app, "/a/slug-a/request", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        reason: "invalid-request",
      });
    }
    expect(w.appRequests).toEqual([]);
  });

  it("reports an agent that does not wake as unreachable", async () => {
    const { app } = world({ wakeFails: true });
    const res = await call(app, "/a/slug-a/request", getState);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "agent-unreachable",
    });
  });

  /**
   * TEST_SCENARIO: Whoever made the owner's Agent act must be on record. An
   * allowed call and a refused one are both logged with the viewer as the
   * actor, the artifact and the owner, and never with what the page sent.
   */
  it("records every call under the viewer in the security log", async () => {
    const { w, app } = world();
    await call(app, "/a/slug-a/request", {
      method: "GET",
      path: "/secret-path",
    });
    await call(app, "/a/slug-a/request", getState, { sid: "sid-bob" });
    w.featureOn = false;
    await call(app, "/a/slug-a/request", getState);
    expect(loggedEvents()).toEqual([
      expect.objectContaining({
        level: "info",
        event: "artifact.viewer_request",
        actor: "alice-sub",
        actorKind: "external",
        surface: "share",
        decision: "allow",
        target: "a1",
        agentId: "agent-1",
        detail: { viewerEmail: "alice@example.com", owner: "owner-1" },
      }),
      expect.objectContaining({
        event: "artifact.viewer_request",
        actor: "bob-sub",
        decision: "deny",
        reason: "not-a-viewer",
      }),
      expect.objectContaining({
        actor: "alice-sub",
        decision: "deny",
        reason: "feature-off",
      }),
    ]);
    expect(JSON.stringify(securityLog.mock.calls)).not.toContain("secret-path");
  });
});

describe("the relay token", () => {
  const sharePage = (app: ReturnType<typeof world>["app"]) =>
    app.request("/a/slug-a", {
      headers: { cookie: "__Host-share_session=sid-alice" },
    });

  const tokenIn = (html: string) =>
    /authorization: "Bearer ([A-Za-z0-9_-]+)"/.exec(html)?.[1];

  /**
   * TEST_SCENARIO: The share cookie rides every request to the share host,
   * and any page on the same site can forge one with the share origin, if
   * the origin check ever lets it through. Such a call carries the viewer's
   * real cookie and the share origin, but not the token that only the share
   * page holds, so it is refused before any Agent wakes, and logged.
   */
  it("refuses a forged call that carries the viewer's cookie and the share origin", async () => {
    const { w, app } = world();
    for (const path of ["/a/slug-a/request", "/a/slug-a/prompt"]) {
      const res = await call(
        app,
        path,
        path.endsWith("/prompt") ? { prompt: "Delete it all." } : getState,
        { token: null },
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, reason: "not-allowed" });
    }
    expect(w.agentAwake).toBe(false);
    expect(w.appRequests).toEqual([]);
    expect(w.delivered).toEqual([]);
    expect(loggedEvents()).toEqual([
      expect.objectContaining({
        event: "artifact.viewer_request",
        actor: "alice-sub",
        decision: "deny",
        reason: "no-relay-token",
      }),
      expect.objectContaining({
        event: "artifact.viewer_prompt",
        actor: "alice-sub",
        decision: "deny",
        reason: "no-relay-token",
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: A token proves one share page: the one this viewer opened,
   * in this sign-in, for this artifact at its current version. A token minted
   * for another viewer, an earlier sign-in, another artifact or the previous
   * version is refused, so a token that leaks, or outlives a sign-out or a
   * new version, opens nothing.
   */
  it.each([
    ["another viewer", () => relayTokenFor("sid-bob")],
    ["an earlier sign-in", () => relayTokenFor("sid-alice-earlier")],
    [
      "another artifact",
      () => relayTokenFor("sid-alice", { id: "a2", version: 1 }),
    ],
    [
      "the previous version",
      () => relayTokenFor("sid-alice", { id: "a1", version: 1 }),
      { version: 2 },
    ],
    ["no artifact at all", () => Promise.resolve("x".repeat(43))],
  ])(
    "refuses a token minted for %s",
    async (_name, token, row: Partial<ArtifactRow> = {}) => {
      const { w, app } = world({ artifact: artifactRow(row) });
      const res = await call(app, "/a/slug-a/request", getState, {
        token: await token(),
      });
      expect(res.status).toBe(403);
      expect(w.appRequests).toEqual([]);
    },
  );

  it("reads the token only as a bearer credential", async () => {
    const { w, app } = world();
    const token = await relayTokenFor("sid-alice");
    for (const authorization of [token, `Basic ${token}`, `Bearer  ${token}`]) {
      const res = await app.request("/a/slug-a/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-share_session=sid-alice",
          origin: SHARE,
          authorization,
        },
        body: JSON.stringify(getState),
      });
      expect(res.status).toBe(403);
    }
    expect(w.appRequests).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The share page is what holds the token. Opening it mints
   * one for the viewer and writes it into the page's relay, and the relay's
   * calls with it go through; a reload mints a fresh one.
   */
  it("is minted by the share page, and its relay's calls go through", async () => {
    const { w, app } = world();
    const first = tokenIn(await (await sharePage(app)).text());
    const second = tokenIn(await (await sharePage(app)).text());
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    const res = await call(app, "/a/slug-a/request", getState, {
      token: first!,
    });
    expect(res.status).toBe(200);
    expect(w.appRequests).toHaveLength(1);
  });

  it("is not minted for a page with no relay", async () => {
    const { app } = world({ artifact: artifactRow({ interactive: false }) });
    const html = await (await sharePage(app)).text();
    expect(tokenIn(html)).toBeUndefined();
    expect(html).not.toContain("/request");
  });
});

describe("a viewer's prompt on a shared interactive page", () => {
  /**
   * TEST_SCENARIO: A viewer clicks a button that asks the Agent to do
   * something. The prompt goes to that viewer's own Session on the owner's
   * Agent, named after the viewer and the page, so the owner sees who asked
   * for what. The Agent is told who sent it and that the viewer sees only the
   * page.
   */
  it("hands the prompt to the viewer's own session on the agent", async () => {
    const { w, app } = world();
    const res = await call(app, "/a/slug-a/prompt", {
      prompt: "Refresh the numbers.",
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(w.delivered).toHaveLength(1);
    const [turn] = w.delivered;
    expect(turn).toMatchObject({
      agentId: "agent-1",
      sessionKey: viewerSessionKey("a1", "alice-sub"),
      sessionTitle: "alice@example.com · Team dashboard",
    });
    expect(turn!.prompt).toContain("alice@example.com");
    expect(turn!.prompt).toContain('"Team dashboard"');
    expect(turn!.prompt).toContain("Message: Refresh the numbers.");
    expect(JSON.stringify(securityLog.mock.calls)).not.toContain("Refresh");
  });

  it("refuses a prompt from someone not on the viewer list", async () => {
    const { w, app } = world();
    const res = await call(
      app,
      "/a/slug-a/prompt",
      { prompt: "Hi" },
      { sid: "sid-bob" },
    );
    expect(res.status).toBe(403);
    expect(w.delivered).toEqual([]);
    expect(loggedEvents()).toEqual([
      expect.objectContaining({
        event: "artifact.viewer_prompt",
        actor: "bob-sub",
        decision: "deny",
        reason: "not-a-viewer",
      }),
    ]);
  });

  it.each(["", "   ", "x".repeat(16_385)])(
    "refuses an invalid prompt %#",
    async (prompt) => {
      const { w, app } = world();
      const res = await call(app, "/a/slug-a/prompt", { prompt });
      expect(await res.json()).toEqual({
        ok: false,
        reason: "invalid-request",
      });
      expect(w.delivered).toEqual([]);
    },
  );

  it("tells the viewer when the agent is at its spend limit", async () => {
    const { app } = world({ deliverOutcome: "spend-limit" });
    const res = await call(app, "/a/slug-a/prompt", { prompt: "Go" });
    expect(await res.json()).toEqual({ ok: false, reason: "spend-limit" });
  });
});

describe("the share page relay", () => {
  const page = (relay: boolean) =>
    renderWrapper({
      title: "Team dashboard",
      brandName: "Platform",
      contentUrl: "https://content.example.com/a/slug-a?v=1&t=tok",
      slug: "slug-a",
      version: 1,
      downloadName: "dashboard.html",
      ...(relay
        ? {
            relay: {
              token: "relay-token-1234567890",
              caller: { role: "viewer" as const, email: "alice@example.com" },
            },
          }
        : {}),
    });

  it("relays only for a page that has one, to its own routes", () => {
    expect(page(false)).not.toContain("/request");
    const html = page(true);
    expect(html).toContain('"/a/slug-a"');
    expect(html).toContain("event.source !== page");
    expect(html).toContain('credentials: "same-origin"');
    expect(html).toContain('authorization: "Bearer relay-token-1234567890"');
  });

  /**
   * TEST_SCENARIO: Every artifact runs on the one content origin. If the
   * relayed frame kept that origin, another artifact could open this share
   * page in a popup, script the frame and make the relay act as the viewer.
   * The relayed frame gets an opaque origin instead; a page with no relay
   * keeps the sandbox it had.
   */
  it("gives the relayed frame an origin no other artifact shares", () => {
    const sandboxOf = (html: string) =>
      /<iframe sandbox="([^"]*)"/.exec(html)?.[1];
    expect(sandboxOf(page(true))).toBe(RELAYED_FRAME_SANDBOX);
    expect(RELAYED_FRAME_SANDBOX).not.toContain("allow-same-origin");
    expect(RELAYED_FRAME_SANDBOX).toContain("allow-scripts");
    expect(sandboxOf(page(false))).toContain("allow-same-origin");
  });
});

describe("viewer session titles", () => {
  it("names the viewer first and stays within the title limit", () => {
    expect(viewerSessionTitle("a@b.c", "Dash")).toBe("a@b.c · Dash");
    const long = viewerSessionTitle("a@b.c", "x".repeat(400));
    expect(long).toHaveLength(200);
    expect(long.startsWith("a@b.c · ")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("delivering a viewer's prompt", () => {
  type Sent = { prompt: string; opts: SendPromptOpts };

  function fakeAcp(listed: { sessionId: string; threadTs: string }[]) {
    const sent: Sent[] = [];
    const turns: (() => void)[] = [];
    const acp: AcpClient = {
      listSessions: () =>
        Promise.resolve(
          listed.map((s) => ({
            sessionId: s.sessionId,
            platform: { threadTs: s.threadTs },
          })),
        ),
      sendPrompt: (prompt, opts) => {
        sent.push({ prompt: prompt as string, opts });
        if (!("resumeSessionId" in opts)) {
          listed.push({
            sessionId: `s-${listed.length + 1}`,
            threadTs: opts.platformMeta?.threadTs ?? "",
          });
          opts.onSession?.(`s-${listed.length}`);
        }
        return new Promise<string>((resolve) => turns.push(() => resolve("")));
      },
      steer: () => Promise.resolve("unsupported"),
      triggerSession: () => Promise.reject(new Error("unused")),
      turnStatus: () => Promise.resolve("unknown"),
    };
    return {
      acp,
      sent,
      finishTurns: () => turns.splice(0).forEach((f) => f()),
    };
  }

  function delivery(
    acp: AcpClient,
    opts: { hold?: "limit" | null; wakeFails?: boolean } = {},
  ) {
    const open: string[] = [];
    let woke = 0;
    const d = createViewerPromptDelivery({
      makeAcpClient: () => acp,
      ensureReady: () => {
        woke += 1;
        return opts.wakeFails
          ? Promise.reject(new Error("no"))
          : Promise.resolve();
      },
      spendHold: () => Promise.resolve(opts.hold ?? null),
      attendance: {
        openChannelTurn: (agentId) => {
          open.push(agentId);
          return () => open.splice(open.indexOf(agentId), 1);
        },
      },
    });
    return { d, open, woke: () => woke };
  }

  const turn = {
    agentId: "agent-1",
    sessionKey: "artifact:a1:alice-sub",
    sessionTitle: "alice@example.com · Team dashboard",
    prompt: "framed prompt",
  };

  afterEach(() => vi.useRealTimers());

  /**
   * TEST_SCENARIO: The first prompt opens the viewer's Session, named for the
   * owner to read and keyed so it can be found again. The turn runs as an
   * unattended channel turn, and the viewer gets their answer as soon as the
   * Agent is awake, not when the turn ends.
   */
  it("opens a named session, unattended, and answers before the turn ends", async () => {
    const { acp, sent, finishTurns } = fakeAcp([]);
    const { d, open } = delivery(acp);
    await expect(d.deliver(turn)).resolves.toBe("accepted");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.opts).toMatchObject({
      platformMeta: {
        threadTs: "artifact:a1:alice-sub",
        customTitle: "alice@example.com · Team dashboard",
      },
    });
    expect(open).toEqual(["agent-1"]);
    finishTurns();
    await vi.waitFor(() => expect(open).toEqual([]));
  });

  /**
   * TEST_SCENARIO: A viewer clicks twice in quick succession. The second
   * prompt waits until the first has named its Session, then continues it,
   * so one viewer never ends up with two Sessions for one page.
   */
  it("continues the viewer's session, even after a quick double click", async () => {
    const { acp, sent, finishTurns } = fakeAcp([]);
    const { d } = delivery(acp);
    await d.deliver(turn);
    await d.deliver({ ...turn, prompt: "second" });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.opts).toMatchObject({ resumeSessionId: "s-1" });
    finishTurns();
  });

  it("starts fresh when the stored session cannot be loaded", async () => {
    const { acp, sent } = fakeAcp([
      { sessionId: "gone", threadTs: "artifact:a1:alice-sub" },
    ]);
    const original = acp.sendPrompt;
    acp.sendPrompt = (prompt, opts) =>
      "resumeSessionId" in opts
        ? Promise.reject(new AcpSessionLoadError("gone"))
        : original(prompt, opts);
    const { d } = delivery(acp);
    await d.deliver(turn);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.opts).toMatchObject({
      platformMeta: { threadTs: "artifact:a1:alice-sub" },
    });
  });

  /**
   * TEST_SCENARIO: An Agent at a spend limit would only have its model calls
   * refused, so a viewer's prompt does not wake it; the viewer is told why.
   */
  it("neither wakes nor prompts an agent at a spend limit", async () => {
    const { acp, sent } = fakeAcp([]);
    const { d, woke } = delivery(acp, { hold: "limit" });
    await expect(d.deliver(turn)).resolves.toBe("spend-limit");
    expect(woke()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("reports an agent that does not wake", async () => {
    const { acp, sent } = fakeAcp([]);
    const { d } = delivery(acp, { wakeFails: true });
    await expect(d.deliver(turn)).resolves.toBe("agent-unreachable");
    expect(sent).toEqual([]);
  });
});
