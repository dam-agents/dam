import { RESULT_ACCEPTED_FIELD, toolOutputTexts } from "agent-runtime-api";
import { artifactTouchPayloadSchema } from "api-server-api";

export interface SubAgentSpawn {
  sessionId: string;
  subAgentIds: string[];
}

export interface ArtifactTouch {
  sessionId: string;
  artifactId: string;
  version: number;
}

export interface ToolCallOutcome {
  sessionId: string;
  accepted: boolean;
  artifactTouch: ArtifactTouch | null;
  subAgentSpawn: SubAgentSpawn | null;
}

const RESULT_ACCEPTED = new RegExp(
  `\\\\?"${RESULT_ACCEPTED_FIELD}\\\\?"\\s*:\\s*true`,
);

const SPAWN_LINE =
  /^(?:\d+\t)?\[invoke\] spawned .+? -> (?<id>agent-[a-z0-9]+)$/;

interface ToolCallUpdate {
  sessionUpdate?: unknown;
  status?: unknown;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads what a finished tool call in a Session
 * reported, once, from the one output array the frame carries. Three reports
 * travel that way and each has its own reader here: an accepted report_result,
 * whose marker is the only sign the target's runtime gets that its run has a
 * result; an artifact touch, which the artifacts panel records; and the
 * sub-agent ids a spawn printed, so an outcome delivered later lands in the
 * Session that asked for it.
 */
export function toolCallOutcomeIn(frame: unknown): ToolCallOutcome | null {
  const params = (frame as { params?: unknown } | null)?.params;
  const sessionId = (params as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  const update = (params as { update?: ToolCallUpdate } | null)?.update;
  if (update?.sessionUpdate !== "tool_call_update") return null;
  if (update.status !== "completed") return null;

  const texts = toolOutputTexts(update);
  return {
    sessionId,
    accepted: texts.some((text) => RESULT_ACCEPTED.test(text)),
    artifactTouch: artifactTouchOf(texts, sessionId),
    subAgentSpawn: subAgentSpawnOf(texts, sessionId),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The artifact one output of a finished tool call
 * touched, read from the `platform_artifact_touch` payload inside it.
 */
function artifactTouchOf(
  texts: readonly string[],
  sessionId: string,
): ArtifactTouch | null {
  for (const text of texts) {
    const marker = artifactTouchMarkerIn(text);
    if (marker) return { sessionId, ...marker };
  }
  return null;
}

function artifactTouchMarkerIn(
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sub-agents one output of a finished tool call
 * spawned, read from the `[invoke] spawned <label> -> <id>` lines that both
 * spawn_subagent and the driver SDK print.
 */
function subAgentSpawnOf(
  texts: readonly string[],
  sessionId: string,
): SubAgentSpawn | null {
  const ids = new Set<string>();
  for (const text of texts)
    for (const line of text.split("\n")) {
      const id = SPAWN_LINE.exec(line.trim())?.groups?.id;
      if (id) ids.add(id);
    }
  return ids.size > 0 ? { sessionId, subAgentIds: [...ids] } : null;
}
