import {
  editorEmailOf,
  type AgentPermission,
  type UserIdentity,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";

const EDITOR_RUNTIME_PROCEDURES: ReadonlyMap<string, AgentPermission> = new Map(
  [
    ["harnessConfig.current", "view"],
    ["harnessConfig.catalog", "view"],
    ["harnessConfig.models", "view"],
    ["processes.list", "view"],
    ["processes.applyPendingRestart", "lifecycle"],
  ],
);

export type EditorRuntimeAccess = (
  agentId: string,
  user: UserIdentity,
  call: { paths: readonly string[]; mutation: boolean },
) => Promise<boolean>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which calls an Agent Editor may make to a Shared
 * Agent's own runtime over HTTP. The agent's page reads its live model
 * settings and pending restart from the runtime, so an editor reaches those
 * few procedures and nothing else: sessions, files and terminals stay with
 * the owner. Every procedure in a batch must be one of them and its Agent
 * Permission held. A change an editor makes is an audit record naming them.
 */
export function createEditorRuntimeAccess(deps: {
  editorStanding: (
    agentId: string,
    caller: { sub: string; editorEmail: string },
  ) => Promise<{ ownerSub: string; permissions: AgentPermission[] } | null>;
}): EditorRuntimeAccess {
  return async (agentId, user, { paths, mutation }) => {
    const editorEmail = editorEmailOf(user);
    if (editorEmail === null || paths.length === 0) return false;
    const needed = paths.map((path) => EDITOR_RUNTIME_PROCEDURES.get(path));
    if (needed.some((permission) => permission === undefined)) return false;
    const standing = await deps.editorStanding(agentId, {
      sub: user.sub,
      editorEmail,
    });
    if (!standing) return false;
    if (!needed.every((p) => p && standing.permissions.includes(p)))
      return false;
    if (mutation)
      securityLog("info", "agent.editor_act", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        agentId,
        result: "success",
        decision: "allow",
        detail: { ownerSub: standing.ownerSub, procedure: paths.join(",") },
      });
    return true;
  };
}
