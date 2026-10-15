import { toolOutputTexts } from "agent-runtime-api";
import { artifactTouchPayloadSchema } from "api-server-api";

export interface ArtifactTouch {
  sessionId: string;
  artifactId: string;
  version: number;
}

interface ToolCallUpdate {
  sessionUpdate?: unknown;
  status?: unknown;
}

function markerIn(
  text: string,
): { artifactId: string; version: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = artifactTouchPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  const { artifactId, version } = result.data.platform_artifact_touch;
  return { artifactId, version };
}

export function artifactTouchIn(frame: unknown): ArtifactTouch | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;

  const update = (params as { update?: ToolCallUpdate } | null)?.update;
  if (update?.sessionUpdate !== "tool_call_update") return null;
  if (update.status !== "completed") return null;

  for (const text of toolOutputTexts(update)) {
    const marker = markerIn(text);
    if (marker) return { sessionId, ...marker };
  }
  return null;
}
