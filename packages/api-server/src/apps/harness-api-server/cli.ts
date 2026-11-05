import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Hono } from "hono";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { MAX_TRPC_BATCH_SIZE } from "../../core/request-body-bounds.js";
import { securityLog } from "../../core/security-log.js";
import {
  agentOnBehalfUser,
  type AgentOnBehalfRefusal,
  type AgentOnBehalfVerifier,
} from "../../modules/agent-on-behalf/index.js";

/* UNIT_BOUNDARY_DESCRIPTION: the header an owner gateway stamps with the Agent
 * whose harness guard let the request through, and strips on every other route.
 * A request that carries it and names another Agent did not come through that
 * Agent's guard, so it is refused here even though the mesh already decided. */
const HARNESS_AGENT_HEADER = "x-platform-harness-agent";

export interface CliRoutesDeps {
  verifyAgentOnBehalf: AgentOnBehalfVerifier;
  contextFor: (user: UserIdentity, surface: string) => ApiContext;
}

class CliRefusal extends Error {
  constructor(
    readonly kind: AgentOnBehalfRefusal | "spoofed-agent",
    readonly status: 403 | 404,
  ) {
    super(kind);
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an assistant's own machine finds at its own
 * harness path — the platform API that the CLI in its image drives. The proof the caller is that Agent is the harness API's own (the mesh
 * admits an Agent's gateway for `/api/agents/<id>/` and for no sibling); every
 * check the token used to carry is read live here instead, and the principal is
 * derived from the Agent, so nothing secret ever exists inside the machine.
 * Only the app's tRPC router is reachable this way: no relay, no agent proxy,
 * no runtime router, and HTTP with no upgrade. Batching is one HTTP request but
 * one procedure per call, so the gate decides each call on its own.
 */
export function mountCliRoutes(app: Hono, deps: CliRoutesDeps): void {
  const resolve = async (c: {
    req: {
      param(name: string): string | undefined;
      header(name: string): string | undefined;
    };
  }): Promise<{ agentId: string; user: UserIdentity }> => {
    const agentId = c.req.param("id")!;
    const stamped = c.req.header(HARNESS_AGENT_HEADER);
    if (stamped !== undefined && stamped !== agentId) {
      throw new CliRefusal("spoofed-agent", 403);
    }
    const verified = await deps.verifyAgentOnBehalf(agentId);
    if (!verified.ok) {
      throw new CliRefusal(
        verified.error,
        verified.error === "agent-gone" ? 404 : 403,
      );
    }
    return {
      agentId,
      user: agentOnBehalfUser(verified.value),
    };
  };

  const refuse = (
    c: {
      json(body: unknown, status: 403 | 404): Response;
    },
    err: unknown,
  ): Response => {
    const refusal =
      err instanceof CliRefusal ? err : new CliRefusal("agent-gone", 404);
    securityLog("warn", "cli.refuse", {
      category: "authz",
      actor: null,
      actorKind: "agent",
      surface: "cli",
      decision: "deny",
      reason: refusal.kind,
    });
    return c.json(
      { error: "forbidden", message: messageOf(refusal.kind) },
      refusal.status,
    );
  };

  app.all("/api/agents/:id/cli/trpc/*", async (c) => {
    let user: UserIdentity;
    try {
      ({ user } = await resolve(c));
    } catch (err) {
      return refuse(c, err);
    }

    const url = new URL(c.req.url);
    const prefix = `/api/agents/${encodeURIComponent(c.req.param("id")!)}/cli/trpc`;
    const path = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/^\/+/, "")
      : url.pathname;

    return fetchRequestHandler({
      endpoint: "",
      req: new Request(`${url.origin}/${path}${url.search}`, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body:
          c.req.method === "GET" || c.req.method === "HEAD"
            ? undefined
            : c.req.raw.body,
        duplex: "half",
      } as RequestInit),
      router: appRouter,
      maxBatchSize: MAX_TRPC_BATCH_SIZE,
      createContext: () => deps.contextFor(user, "cli"),
    });
  });
}

function messageOf(kind: AgentOnBehalfRefusal | "spoofed-agent"): string {
  switch (kind) {
    case "agent-gone":
      return "this Agent is gone";
    case "not-assistant":
      return "only an assistant drives the platform for its owner";
    case "owner-mismatch":
      return "this Agent has no owner to act for";
    case "owner-inactive":
      return "the owner's account is not active";
    case "flag-off":
      return "assistants are not offered to this owner";
    case "spoofed-agent":
      return "the request names another Agent than the one that reached us";
  }
}
