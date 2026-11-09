import type { AgentAccess, AgentKind } from "api-server-api";

import { holds } from "../../agents/lib/agent-permissions.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What one Agent's Channels section offers. The
 * assistant's own paragraph belongs to the assistant's kind — an Agent Editor
 * lacks `channelBinding` on every Agent, so the permission alone would tell an
 * editor of an ordinary Agent that their Agent is somebody's alone. The
 * permission decides only whether the controls that add a conversation are
 * there, which is the same answer for an editor and for the assistant's owner.
 */
export function showsAssistantChannelsNotice(
  kind: AgentKind | undefined,
): boolean {
  return kind === "assistant";
}

export function canAddChannel(
  access: AgentAccess,
  kind: AgentKind | undefined,
): boolean {
  if (showsAssistantChannelsNotice(kind)) return false;
  return holds(access, "channelBinding");
}
