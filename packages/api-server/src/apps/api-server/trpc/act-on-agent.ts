import {
  editorEmailOf,
  type AgentPermission,
  type AgentTarget,
  type ApiContext,
  type UserIdentity,
} from "api-server-api";
import { match } from "ts-pattern";
import { securityLog } from "../../../core/security-log.js";
import type { ResolvedTarget } from "./agent-target.js";

/** UNIT_BOUNDARY_DESCRIPTION: why the owner is refused, per Permission the assistant holds back. The message names the assistant as the install brands it, because the owner meets it in their own UI or terminal. */
function assistantRefusal(
  permission: AgentPermission,
  assistantName: string,
): string {
  return match(permission)
    .with(
      "delete",
      () => `${assistantName} is your assistant, so it cannot be deleted.`,
    )
    .with(
      "editors",
      () =>
        `${assistantName} is your assistant, so nobody else can be made its editor.`,
    )
    .with(
      "disable",
      () => `${assistantName} is your assistant, so it cannot be disabled.`,
    )
    .with(
      "channelBinding",
      () =>
        `${assistantName} is your assistant, so it cannot be added to a Slack or Telegram conversation.`,
    )
    .otherwise(
      () => `${assistantName} is your assistant, so you cannot do this.`,
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The request's answer to an Agent Permission
 * check. A caller who is not an Agent Editor of the Agent keeps their own
 * context, so an owner, an API key or a stranger is answered by the service as
 * before — except the assistant's owner, whose Permissions leave out what would
 * remove the assistant, share it, disable it or bind it to a conversation, and
 * who is refused here with a message naming the assistant. An editor holding
 * the permission, and any permission the target's records need, gets a context
 * made for the Agent's owner, bound to that one Agent and naming the editor as
 * the person acting. Each change an editor makes, and each refusal, is an audit
 * record naming the editor, the owner and the procedure.
 */
export function createActOnAgent(deps: {
  user: UserIdentity;
  self: () => ApiContext;
  agentOfTarget: (target: AgentTarget) => Promise<ResolvedTarget | null>;
  ownerPermissions: (
    agentId: string,
    sub: string,
  ) => Promise<AgentPermission[] | null>;
  editorStanding: (
    agentId: string,
    caller: { sub: string; editorEmail: string },
  ) => Promise<{ ownerSub: string; permissions: AgentPermission[] } | null>;
  contextFor: (identity: UserIdentity) => ApiContext;
  assistantName: string;
}): ApiContext["actOnAgent"] {
  return async (target, permission, call) => {
    const asCaller = { ok: true as const, ctx: deps.self() };
    const resolved = await deps.agentOfTarget(target);
    if (resolved === null) return asCaller;
    const { agentId } = resolved;
    const own = await deps.ownerPermissions(agentId, deps.user.sub);
    if (own !== null) {
      const missing = [permission, ...resolved.needs].find(
        (p) => !own.includes(p),
      );
      if (missing === undefined) return asCaller;
      securityLog("warn", "agent.owner_denied", {
        category: "authz",
        actor: deps.user.sub,
        actorKind: "user",
        agentId,
        result: "failure",
        decision: "deny",
        detail: { permission: missing, procedure: call.path },
      });
      return {
        ok: false,
        error: "Forbidden",
        message: assistantRefusal(missing, deps.assistantName),
      };
    }
    const editorEmail = editorEmailOf(deps.user);
    if (editorEmail === null) return asCaller;
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
