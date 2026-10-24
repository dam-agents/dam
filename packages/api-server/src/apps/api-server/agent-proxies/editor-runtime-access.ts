import {
  editorEmailOf,
  type AgentPermission,
  type UserIdentity,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";

const RUNTIME_PROCEDURES: ReadonlyMap<string, AgentPermission> = new Map([
  ["harnessConfig.current", "view"],
  ["harnessConfig.catalog", "view"],
  ["harnessConfig.models", "view"],
  ["harnessConfig.watch", "view"],
  ["processes.list", "view"],
  ["processes.watch", "sessions"],
  ["processes.output", "sessions"],
  ["processes.stop", "sessions"],
  ["processes.setKeep", "sessions"],
  ["processes.applyPendingRestart", "lifecycle"],
  ["processes.restartStartupItem", "lifecycle"],
  ["processes.stopStartupItem", "lifecycle"],
  ["processes.setStartupItemEnabled", "lifecycle"],
  ["processes.removeStartupItem", "lifecycle"],
  ["sessions.list", "sessions"],
  ["sessions.history", "sessions"],
  ["sessions.setTitle", "sessions"],
  ["sessions.watch", "sessions"],
]);

const RUNTIME_NAMESPACES: ReadonlyMap<string, AgentPermission> = new Map([
  ["files", "sessions"],
  ["browser", "sessions"],
  ["changes", "sessions"],
]);

export interface EditorStanding {
  ownerSub: string;
  permissions: AgentPermission[];
}

export type EditorStandingOf = (
  agentId: string,
  caller: { sub: string; editorEmail: string },
) => Promise<EditorStanding | null>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which calls an Agent Editor may make to a Shared
 * Agent's own runtime, over HTTP and over the runtime's tRPC socket. Each
 * runtime procedure an editor may reach maps to the Agent Permission it
 * needs: the session screen and its side panels (files, browser, changes,
 * running processes) need `sessions`, the live model settings need `view`,
 * and startup items and a pending restart need `lifecycle`. A procedure not on
 * the map stays with the owner: SSH keys, publishing and the platform's own
 * calls. A change an editor makes is an audit record naming them.
 */
export function editorMayCall(
  permissions: readonly AgentPermission[],
  path: string,
): boolean {
  const permission =
    RUNTIME_PROCEDURES.get(path) ??
    RUNTIME_NAMESPACES.get(path.split(".")[0] ?? "");
  return permission !== undefined && permissions.includes(permission);
}

export function auditEditorRuntimeCall(
  editorSub: string,
  agentId: string,
  ownerSub: string,
  procedure: string,
): void {
  securityLog("info", "agent.editor_act", {
    category: "authz",
    actor: editorSub,
    actorKind: "user",
    agentId,
    result: "success",
    decision: "allow",
    detail: { ownerSub, procedure },
  });
}

export type EditorRuntimeAccess = (
  agentId: string,
  user: UserIdentity,
  call: { paths: readonly string[]; mutation: boolean },
) => Promise<boolean>;

export function createEditorRuntimeAccess(deps: {
  editorStanding: EditorStandingOf;
}): EditorRuntimeAccess {
  return async (agentId, user, { paths, mutation }) => {
    const editorEmail = editorEmailOf(user);
    if (editorEmail === null || paths.length === 0) return false;
    const standing = await deps.editorStanding(agentId, {
      sub: user.sub,
      editorEmail,
    });
    if (!standing) return false;
    if (!paths.every((path) => editorMayCall(standing.permissions, path)))
      return false;
    if (mutation)
      auditEditorRuntimeCall(
        user.sub,
        agentId,
        standing.ownerSub,
        paths.join(","),
      );
    return true;
  };
}
