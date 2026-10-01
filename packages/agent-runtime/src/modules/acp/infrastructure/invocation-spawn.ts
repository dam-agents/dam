export interface InvocationSpawn {
  sessionId: string;
  invocationIds: string[];
}

const SPAWN_LINE =
  /^(?:\d+\t)?\[invoke\] spawned .+? -> (?<id>agent-[a-z0-9]+)$/;

function textBlocks(rawOutput: unknown): string[] {
  if (typeof rawOutput === "string") return [rawOutput];
  if (!Array.isArray(rawOutput)) return [];
  return rawOutput.flatMap((block) => {
    if (typeof block === "string") return [block];
    const text = (block as { text?: unknown } | null)?.text;
    return typeof text === "string" ? [text] : [];
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Invocations a finished tool call in a Session
 * started, read from the `[invoke] spawned <label> -> <id>` lines that both
 * invoke_agent and the driver SDK print, so an outcome delivered later can be
 * put back into the Session that asked for it.
 */
export function invocationSpawnIn(frame: unknown): InvocationSpawn | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;

  const update = (
    params as {
      update?: {
        sessionUpdate?: unknown;
        status?: unknown;
        rawOutput?: unknown;
      };
    } | null
  )?.update;
  if (update?.sessionUpdate !== "tool_call_update") return null;
  if (update.status !== "completed") return null;

  const ids = new Set<string>();
  for (const text of textBlocks(update.rawOutput))
    for (const line of text.split("\n")) {
      const id = SPAWN_LINE.exec(line.trim())?.groups?.id;
      if (id) ids.add(id);
    }
  return ids.size > 0 ? { sessionId, invocationIds: [...ids] } : null;
}
