import {
  editorEmailOf,
  type AgentPermission,
  type AgentTarget,
  type ApiContext,
  type UserIdentity,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import type { ResolvedTarget } from "./agent-target.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The request's answer to an Agent Permission
 * check. A caller who is not an Agent Editor of the Agent keeps their own
 * context, so nothing changes for owners, API keys or strangers. An editor
 * holding the permission, and any permission the target's records need,
 * gets a context made for the Agent's owner, bound to
 * that one Agent and naming the editor as the person acting. Each change an
 * editor makes, and each refusal, is an audit record naming the editor, the
 * owner and the procedure.
 */
export function createActOnAgent(deps: {
  user: UserIdentity;
  self: () => ApiContext;
  agentOfTarget: (target: AgentTarget) => Promise<ResolvedTarget | null>;
  editorStanding: (
    agentId: string,
    caller: { sub: string; editorEmail: string },
  ) => Promise<{ ownerSub: string; permissions: AgentPermission[] } | null>;
  contextFor: (identity: UserIdentity) => ApiContext;
}): ApiContext["actOnAgent"] {
  return async (target, permission, call) => {
    const asCaller = { ok: true as const, ctx: deps.self() };
    const editorEmail = editorEmailOf(deps.user);
    if (editorEmail === null) return asCaller;
    const resolved = await deps.agentOfTarget(target);
    if (resolved === null) return asCaller;
    const { agentId } = resolved;
    const standing = await deps.editorStanding(agentId, {
      sub: deps.user.sub,
      editorEmail,
    });
    if (!standing) return asCaller;
    const required = [...new Set([permission, ...resolved.needs])];
    const allowed = required.every((p) => standing.permissions.includes(p));
    if (call.mutation || !allowed)
      securityLog(allowed ? "info" : "warn", "agent.editor_act", {
        category: "authz",
        actor: deps.user.sub,
        actorKind: "user",
        agentId,
        result: allowed ? "success" : "failure",
        decision: allowed ? "allow" : "deny",
        detail: {
          ownerSub: standing.ownerSub,
          permission: required.join(","),
          procedure: call.path,
        },
      });
    if (!allowed) return { ok: false, error: "Forbidden" };
    return {
      ok: true,
      ctx: deps.contextFor({
        sub: standing.ownerSub,
        preferredUsername: standing.ownerSub,
        scopes: deps.user.scopes,
        agentIds: [agentId],
        actingEditor: deps.user.sub,
        actingEditorEmail: editorEmail,
      }),
    };
  };
}
