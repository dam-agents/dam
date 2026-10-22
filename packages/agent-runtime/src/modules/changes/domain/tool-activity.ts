export interface ToolActivity {
  sessionId: string;
}

interface ToolCallFrameUpdate {
  sessionUpdate?: unknown;
  status?: unknown;
}

export type ToolActivityReader = (frame: unknown) => ToolActivity | null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: names the Session of every tool call that
 * finished. A finished tool call may have changed a working tree or run git,
 * so it is when the Changes panel reads the list again and the Session's
 * pull requests are looked up; what the call did is not read.
 */
export function createToolActivityReader(): ToolActivityReader {
  return (frame) => {
    const params = (frame as { params?: unknown } | null)?.params;
    const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") return null;
    const update = (params as { update?: ToolCallFrameUpdate } | null)?.update;
    if (update?.sessionUpdate !== "tool_call_update") return null;
    const settled = update.status === "completed" || update.status === "failed";
    return settled ? { sessionId } : null;
  };
}
