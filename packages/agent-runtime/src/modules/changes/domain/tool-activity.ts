export interface ToolActivity {
  sessionId: string;
  editedPaths: string[];
  settled: boolean;
}

interface ToolCallFrameUpdate {
  sessionUpdate?: unknown;
  kind?: unknown;
  status?: unknown;
  locations?: unknown;
  rawInput?: unknown;
  content?: unknown;
}

const EDIT_INPUT_KEYS = ["file_path", "notebook_path", "path"] as const;

function absolute(value: unknown): string[] {
  return typeof value === "string" && value.startsWith("/") ? [value] : [];
}

function pathsOf(update: ToolCallFrameUpdate): string[] {
  const fromLocations = Array.isArray(update.locations)
    ? update.locations.flatMap((location) =>
        absolute((location as { path?: unknown } | null)?.path),
      )
    : [];
  const input = update.rawInput as Record<string, unknown> | null | undefined;
  const fromInput =
    input && typeof input === "object"
      ? EDIT_INPUT_KEYS.flatMap((key) => absolute(input[key]))
      : [];
  const fromContent = Array.isArray(update.content)
    ? update.content.flatMap((item) => {
        const block = item as { type?: unknown; path?: unknown } | null;
        return block?.type === "diff" ? absolute(block.path) : [];
      })
    : [];
  return [...new Set([...fromLocations, ...fromInput, ...fromContent])];
}

export function toolActivityIn(frame: unknown): ToolActivity | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const update = (params as { update?: ToolCallFrameUpdate } | null)?.update;
  if (
    update?.sessionUpdate !== "tool_call" &&
    update?.sessionUpdate !== "tool_call_update"
  )
    return null;
  const settled = update.status === "completed" || update.status === "failed";
  const editedPaths = update.kind === "edit" ? pathsOf(update) : [];
  if (!settled && editedPaths.length === 0) return null;
  return { sessionId, editedPaths, settled };
}
