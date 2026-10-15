export interface ToolActivity {
  sessionId: string;
  toolCallId: string | null;
  editedPaths: string[];
  started: boolean;
  settled: boolean;
}

interface ToolCallFrameUpdate {
  sessionUpdate?: unknown;
  toolCallId?: unknown;
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

export const MAX_OPEN_EDITS = 500;

export type ToolActivityReader = (frame: unknown) => ToolActivity | null;

export function createToolActivityReader(): ToolActivityReader {
  const openEdits = new Set<string>();

  function isEdit(key: string | null, kind: unknown): boolean {
    if (key === null) return kind === "edit";
    if (kind === "edit") {
      openEdits.delete(key);
      openEdits.add(key);
      for (const oldest of openEdits) {
        if (openEdits.size <= MAX_OPEN_EDITS) break;
        openEdits.delete(oldest);
      }
      return true;
    }
    if (kind !== undefined) openEdits.delete(key);
    return openEdits.has(key);
  }

  return (frame) => {
    const params = (frame as { params?: unknown } | null)?.params;
    const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") return null;
    const update = (params as { update?: ToolCallFrameUpdate } | null)?.update;
    if (
      update?.sessionUpdate !== "tool_call" &&
      update?.sessionUpdate !== "tool_call_update"
    )
      return null;
    const toolCallId =
      typeof update.toolCallId === "string" && update.toolCallId !== ""
        ? update.toolCallId
        : null;
    const key = toolCallId === null ? null : `${sessionId}\n${toolCallId}`;
    const started = update.sessionUpdate === "tool_call";
    const settled = update.status === "completed" || update.status === "failed";
    const editedPaths = isEdit(key, update.kind) ? pathsOf(update) : [];
    if (settled && key !== null) openEdits.delete(key);
    if (!started && !settled && editedPaths.length === 0) return null;
    return { sessionId, toolCallId, editedPaths, started, settled };
  };
}
