import { toolOutputTexts } from "agent-runtime-api";

export interface SubAgentSpawn {
  sessionId: string;
  subAgentIds: string[];
}

const SPAWN_LINE =
  /^(?:\d+\t)?\[invoke\] spawned .+? -> (?<id>agent-[a-z0-9]+)$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sub-agents a finished tool call in a Session
 * spawned, read from the `[invoke] spawned <label> -> <id>` lines that both
 * spawn_subagent and the driver SDK print, so an outcome delivered later can be
 * put back into the Session that asked for it.
 */
export function subAgentSpawnIn(frame: unknown): SubAgentSpawn | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;

  const update = (
    params as { update?: { sessionUpdate?: unknown; status?: unknown } } | null
  )?.update;
  if (update?.sessionUpdate !== "tool_call_update") return null;
  if (update.status !== "completed") return null;

  const ids = new Set<string>();
  for (const text of toolOutputTexts(update))
    for (const line of text.split("\n")) {
      const id = SPAWN_LINE.exec(line.trim())?.groups?.id;
      if (id) ids.add(id);
    }
  return ids.size > 0 ? { sessionId, subAgentIds: [...ids] } : null;
}
