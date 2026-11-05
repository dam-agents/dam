import type { Hono } from "hono";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";
import type { AgentTokenCodec } from "../../modules/agent-tokens/index.js";
import { securityLog } from "../../core/security-log.js";

export interface CliTokenDeps {
  readAgent: (id: string) => Promise<KubeObject | null>;
  mintToken: AgentTokenCodec;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the install offers assistants to this owner right now; the mint refuses as the api-server's verifier would refuse at every use. */
  featureOn: (owner: string) => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the owner behind the Agent is still a person the install admits; a deleted or disabled account gets no token, and an answer the directory cannot give refuses one rather than minting it. */
  ownerActive: (owner: string) => Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one exchange an assistant makes for its own
 * short-lived bearer, and the proof it is that assistant is the one the harness
 * API already rests on: this path is reachable only from the Agent's own
 * gateway, which the mesh admits for `/api/agents/<id>/` and for no sibling.
 * The Agent, its kind, its owner and the owner's account are read from live
 * facts, so a deleted Agent, a plain Agent or an owner who turned assistants
 * off gets no token at all.
 *
 * The ceiling this route has today: it answers with the bearer itself, so any
 * process in the guest can ask for one and replay it for its fifteen minutes —
 * which is why the transport decision (whether the CLI reaches the platform
 * through this install's public API or through the assistant's own harness
 * path) decides whether the route survives at all. On the harness path the
 * bearer goes away: the mesh-proven path is the authentication, and the
 * principal is derived from the Agent identity the route already holds
 * (`agentOnBehalfUser`). The upgrade path is to stop answering with a token.
 */
export function mountCliTokenRoute(app: Hono, deps: CliTokenDeps): void {
  app.post("/api/agents/:id/cli-token", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.readAgent, agentId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const refuse = (reason: string) => {
      securityLog("warn", "agent_token.deny", {
        category: "authn",
        actor: agentId,
        actorKind: "agent",
        surface: "cli",
        agentId,
        decision: "deny",
        reason,
      });
      return c.json({ error: "forbidden", message: reason }, 403);
    };

    if (verified.kind !== "assistant")
      return refuse("only an assistant exchanges its identity for a token");
    const active = await deps.ownerActive(verified.owner).catch(() => false);
    if (!active) return refuse("the owner's account is not active");
    const offered = await deps.featureOn(verified.owner).catch(() => false);
    if (!offered) return refuse("assistants are not offered to this owner");

    const { token, expiresAt } = deps.mintToken.mint({
      agentId,
      ownerSub: verified.owner,
    });
    securityLog("info", "agent_token.mint", {
      category: "authn",
      actor: agentId,
      actorKind: "agent",
      surface: "cli",
      agentId,
      result: "success",
    });
    return c.json({ token, expiresAt: expiresAt.toISOString() });
  });
}
