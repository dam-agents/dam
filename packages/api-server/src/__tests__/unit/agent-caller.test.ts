// TEST_OVERVIEW: An Agent that presents its own Agent Key to the platform API is that Agent, acting as itself. The key opens the API only while the Agent's grant of the platform Connection stores a Platform Access that lets it read itself. The Agent then reads itself and nothing else: every other procedure and every route outside tRPC is closed to it, and the security log names the Agent as the actor.
import { describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: () => Object.assign(() => ({}), { reload: vi.fn() }),
  jwtVerify: vi.fn(),
}));

import {
  AGENT_CALLER_PROCEDURES,
  AGENT_CALLER_REFUSAL,
  type ApiContext,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import {
  authenticatePrincipal,
  createAuth,
} from "../../apps/api-server/admission/auth.js";
import {
  createAgentCallerVerifier,
  type AgentCaller,
} from "../../apps/api-server/admission/agent-caller.js";
import { createAuthMiddleware } from "../../apps/api-server/admission/auth-middleware.js";
import { logInternalError } from "../../apps/api-server/trpc/log-internal-error.js";
import { configureLogger } from "../../core/logger.js";
import type { OwnerActiveState } from "../../modules/api-keys/index.js";
import { callerContext } from "../helpers/caller-context.js";

type User = ApiContext["user"];

const AGENT_KEY = `ak_${"k".repeat(43)}`;
const AGENT: AgentCaller = { agentId: "agent-a", ownerSub: "owner-1" };
const AS_ITSELF: User = {
  sub: "owner-1",
  preferredUsername: "owner-1",
  scopes: ["agents:read"],
  agentIds: ["agent-a"],
  actingAgent: "agent-a",
};

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

function login(
  opts: {
    agent?: AgentCaller | null;
    readsItself?: boolean;
    owner?: OwnerActiveState;
  } = {},
) {
  const auth = createAuth(
    {
      issuers: ["http://kc/realms/platform"],
      jwksUrl: "http://kc/jwks",
      audience: "platform-api",
    },
    {
      verifyAgentKey: createAgentCallerVerifier({
        agentOfKey: async () => (opts.agent === undefined ? AGENT : opts.agent),
        readsItself: async () => opts.readsItself ?? true,
      }),
      verifyOwnerActive: async () => opts.owner ?? "active",
    },
  );
  const authenticate = (token: string, target = "/api/trpc/agents.list") =>
    authenticatePrincipal(auth.verify, token, { edge: "http", target });
  return { auth, authenticate };
}

function request(path: string) {
  const responses: { body: unknown; status: number }[] = [];
  const c = {
    req: {
      path,
      header: (name: string) =>
        name.toLowerCase() === "authorization"
          ? `Bearer ${AGENT_KEY}`
          : undefined,
    },
    set: () => {},
    json: (body: unknown, status: number) => {
      responses.push({ body, status });
      return { body, status };
    },
  };
  return { c, responses };
}

describe("an Agent Key at the platform API's login", () => {
  // TEST_SCENARIO: the key names an Agent whose grant lets it read itself. The caller is that Agent: bound to itself, read-only, with its owner's subject and no key id or email, so nothing made for a person applies to it.
  it("makes the key's Agent the caller, bound to itself and read-only", async () => {
    const { user } = await login().auth.verify(AGENT_KEY);
    expect(user).toEqual(AS_ITSELF);
  });

  // TEST_SCENARIO: a key the platform never issued, or whose Agent lost it, names nobody. It is refused as any unknown credential is, and the log says which check failed.
  it("refuses a key that names no Agent", async () => {
    const cap = capture();
    const admitted = await login({ agent: null }).authenticate(AGENT_KEY);
    expect(admitted).toEqual({ ok: false, kind: "unauthorized" });
    const denial = cap.records().find((r) => r.msg === "authn.deny");
    expect(denial.reason).toBe("agent-key-unknown");
  });

  // TEST_SCENARIO: the owner never let this Agent act as itself, or took that back. Its key still opens Environments, and it must not open the platform API.
  it("refuses an Agent whose grant stores no Platform Access", async () => {
    const cap = capture();
    const admitted = await login({ readsItself: false }).authenticate(
      AGENT_KEY,
    );
    expect(admitted).toEqual({ ok: false, kind: "unauthorized" });
    const denial = cap.records().find((r) => r.msg === "authn.deny");
    expect(denial.reason).toBe("agent-key-no-platform-access");
  });

  // TEST_SCENARIO: everything the Agent reaches is its owner's, so an owner who may no longer act takes the Agent's access with them, as with an API key.
  it("refuses an Agent whose owner may no longer act", async () => {
    const admitted = await login({ owner: "inactive" }).authenticate(AGENT_KEY);
    expect(admitted).toEqual({ ok: false, kind: "unauthorized" });
  });
});

describe("an Agent caller on the HTTP routes", () => {
  const middlewareOf = (authenticate: ReturnType<typeof login>["authenticate"]) =>
    createAuthMiddleware(
      (token, site) =>
        authenticate(token ?? "", site.edge === "http" ? site.target : ""),
      { uiClientId: "platform-ui", cliClientId: "platform-cli" },
    );
  const next = async () => "NEXT" as never;

  // TEST_SCENARIO: tRPC is the one surface that knows which procedures an Agent may call, so the middleware lets the Agent through to it.
  it("lets the Agent through to tRPC", async () => {
    const { c, responses } = request("/api/trpc/agents.list");
    const result = await middlewareOf(login().authenticate)(
      c as never,
      next as never,
    );
    expect(result).toBe("NEXT");
    expect(responses).toEqual([]);
  });

  // TEST_SCENARIO: the routes beside tRPC, such as an agent's own tRPC proxy, the import proxy and the artifact routes, check only that the caller owns the Agent. The Agent carries its owner's subject, so they would treat it as the owner. They are closed to it, and the refusal names the Agent in the security log.
  it("closes every route outside tRPC to the Agent and logs it as the actor", async () => {
    const cap = capture();
    const { c, responses } = request("/api/agents/agent-a/trpc/files.list");
    await middlewareOf(login().authenticate)(c as never, next as never);
    expect(responses).toEqual([
      {
        status: 403,
        body: { error: "forbidden", message: AGENT_CALLER_REFUSAL },
      },
    ]);
    const refusal = cap.records().find((r) => r.msg === "agent.self_act");
    expect(refusal).toMatchObject({
      actor: "agent-a",
      actorKind: "agent",
      agentId: "agent-a",
      decision: "deny",
      reason: "route-closed-to-agents",
      target: "/api/agents/agent-a/trpc/files.list",
    });
  });
});

describe("an Agent caller on tRPC", () => {
  const listed = (id: string) => ({
    agent: { id, spec: {} },
    access: { role: "owner" },
  });

  function setup(user: User = AS_ITSELF) {
    const agents = {
      listWithAccess: vi.fn(async () => [listed("agent-a"), listed("agent-b")]),
      delete: vi.fn(async () => {}),
    };
    const connections = {
      listAndReconcileConnections: vi.fn(async () => []),
    };
    const invocationsQuery = { listTargets: vi.fn(async () => []) };
    const ctx = callerContext({ agents, connections, invocationsQuery, user });
    markTermsProven(ctx);
    return { caller: appRouter.createCaller(ctx), agents, connections };
  }

  // TEST_SCENARIO: the list is narrowed to the one Agent the caller is bound to, so an Agent that reads the list sees itself and none of its owner's other Agents.
  it("shows the Agent itself and no other Agent of its owner", async () => {
    const { caller } = setup();
    const shown = await caller.agents.list();
    expect(shown.map((a) => a.id)).toEqual(["agent-a"]);
  });

  // TEST_SCENARIO: reading another Agent is refused by the same binding that narrows the list.
  it("refuses to read another Agent", async () => {
    const { caller } = setup();
    await expect(caller.agents.get({ id: "agent-b" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  // TEST_SCENARIO: a query the list does not name is closed, even one its read scope would otherwise open, so a procedure added later starts closed to Agents.
  it("refuses a query the list does not name", async () => {
    const { caller, connections } = setup();
    await expect(caller.connections.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: AGENT_CALLER_REFUSAL,
    });
    expect(connections.listAndReconcileConnections).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the Agent changes nothing in the first step, itself included. The refusal comes from the list, before any scope or permission check runs.
  it("refuses every change, the Agent's own included", async () => {
    const { caller, agents } = setup();
    await expect(caller.agents.delete({ id: "agent-a" })).rejects.toMatchObject(
      { code: "FORBIDDEN", message: AGENT_CALLER_REFUSAL },
    );
    expect(agents.delete).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the list holds reads of the Agent itself and nothing else. A procedure added to it by mistake would open that procedure to every Agent on the scale, so the list is pinned here.
  it("opens exactly the two reads of the Agent itself", () => {
    expect([...AGENT_CALLER_PROCEDURES].sort()).toEqual([
      "agents.get",
      "agents.list",
    ]);
  });

  // TEST_SCENARIO: a refused call is a security event of the Agent, not of its owner: the log names the Agent and the procedure it tried.
  it("logs a refused call with the Agent as the actor", async () => {
    const cap = capture();
    const { caller } = setup();
    const refused = await caller.agents
      .delete({ id: "agent-a" })
      .catch((error: unknown) => error);
    logInternalError({ error: refused as never, path: "agents.delete" });
    const refusal = cap.records().find((r) => r.msg === "agent.self_act");
    expect(refusal).toMatchObject({
      actor: "agent-a",
      actorKind: "agent",
      decision: "deny",
      reason: "procedure-closed-to-agents",
      detail: { procedure: "agents.delete" },
    });
  });

  // TEST_SCENARIO: the list applies to Agent callers alone. A person and an API key keep every procedure their scopes open.
  it("leaves a caller that is no Agent as it was", async () => {
    const { caller, connections } = setup({
      sub: "owner-1",
      preferredUsername: "owner-1",
      scopes: ["credentials:read"],
      agentIds: "*",
      keyId: "key-1",
    });
    await caller.connections.list();
    expect(connections.listAndReconcileConnections).toHaveBeenCalled();
  });
});
