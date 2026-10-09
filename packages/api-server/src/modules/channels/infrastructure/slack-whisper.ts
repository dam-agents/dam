import type {
  SlackMessage,
  SlackMessageMetadata,
  SlackWorkspace,
} from "./slack-gateway.js";

const WHISPER_SESSION_METADATA = "agent_whisper_session";

export interface WhisperSession {
  agentId: string;
  origin: string;
  originWorkspace: SlackWorkspace | null;
  user: string;
  checksMembership: boolean;
}

export function whisperSessionMetadata(
  session: WhisperSession,
): SlackMessageMetadata {
  return {
    eventType: WHISPER_SESSION_METADATA,
    payload: {
      agent_id: session.agentId,
      origin: session.origin,
      ...(session.originWorkspace !== null
        ? { origin_workspace: session.originWorkspace }
        : {}),
      user: session.user,
      checks_membership: session.checksMembership,
    },
  };
}

export function parseWhisperSession(
  root: SlackMessage,
  botUserId: string | null,
): WhisperSession | null {
  if (!botUserId || root.user !== botUserId) return null;
  if (root.metadata?.eventType !== WHISPER_SESSION_METADATA) return null;
  const {
    agent_id: agentId,
    origin,
    origin_workspace: originWorkspace,
    user,
    checks_membership: checksMembership,
  } = root.metadata.payload;
  if (
    typeof agentId !== "string" ||
    typeof origin !== "string" ||
    typeof user !== "string"
  )
    return null;
  return {
    agentId,
    origin,
    originWorkspace:
      typeof originWorkspace === "string" ? originWorkspace : null,
    user,
    checksMembership: checksMembership === true,
  };
}
