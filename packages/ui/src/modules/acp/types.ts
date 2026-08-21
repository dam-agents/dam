import type { SessionUpdate } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import type {
  PlatformPromptAcceptedParams,
  PlatformPromptStartedParams,
  PlatformTurnEndedParams,
} from "api-server-api";

export type AcpUpdate =
  | SessionUpdate
  | ({ sessionUpdate: "platform_turn_ended" } & PlatformTurnEndedParams)
  | ({
      sessionUpdate: "platform_prompt_accepted";
    } & PlatformPromptAcceptedParams)
  | ({ sessionUpdate: "platform_prompt_started" } & PlatformPromptStartedParams)
  | { sessionUpdate: "platform_clipped_replay"; older?: string };

export type UpdateHandler = (
  update: AcpUpdate,
  sessionId: string,
  replayFor?: string,
) => void;
