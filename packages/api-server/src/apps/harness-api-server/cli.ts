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
    readonly kind: CliRefusalKind,
    readonly status: 403 | 404,
  ) {
    super(kind);
  }
}

/* UNIT_BOUNDARY_DESCRIPTION: a subscription is a stream admitted once and never
 * read again, and the owner's live events would outlive the request that opened
 * it — past the owner's account being disabled and past the feature being
 * switched off. So the mount refuses every procedure of that type, looked up by
 * type rather than by name: one added to the router later is refused the day it
 * lands, without anyone remembering this list. */
function subscriptionPathsIn(path: string): string[] {
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, { _def: { type: string } }> };
    }
  )._def.procedures;
  return path
    .split(",")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter((name) => procedures[name]?._def.type === "subscription");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an assistant's own machine finds at its own
 * harness path — the platform API that the CLI in its image drives. The proof
 * the caller is that Agent is the harness API's own (the mesh admits an Agent's
 * gateway for `/api/agents/<id>/` and for no sibling); every
 * check a bearer used to carry is read live here instead, and the principal is
 * derived from the Agent, so nothing secret ever exists inside the machine.
 * Only the app's tRPC router is reachable this way, and only its reads and its
 * calls: no relay, no agent proxy, no runtime router, no subscription, and HTTP
 * with no upgrade. Batching is one HTTP request but one procedure per call, so
 * the gate decides each call on its own.
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

    if (subscriptionPathsIn(path).length > 0)
      return refuse(c, new CliRefusal("subscription", 403));

    const response = await fetchRequestHandler({
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
    /* UNIT_BOUNDARY_DESCRIPTION: nothing above can subscribe, so nothing above can stream; a stream here would be an adapter that admitted one anyway, and it is refused rather than returned. */
    if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
      securityLog("warn", "cli.refuse", {
        category: "authz",
        actor: null,
        actorKind: "agent",
        surface: "cli",
        decision: "deny",
        reason: "subscription",
      });
      return c.json(
        { error: "forbidden", message: messageOf("subscription") },
        403,
      );
    }
    return response;
  });
}

type CliRefusalKind = AgentOnBehalfRefusal | "spoofed-agent" | "subscription";

function messageOf(kind: CliRefusalKind): string {
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
    case "subscription":
      return "an assistant calls the platform and is answered; it cannot hold one of its streams open";
  }
}
