import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type {
  PlatformPromptAcceptedParams,
  PlatformPromptStartedParams,
  PlatformQueueChangedParams,
  PlatformRunStartedParams,
  PlatformSenderRecordedParams,
  PlatformSessionResetParams,
  PlatformTurnEndedParams,
  PlatformTurnStartedParams,
  PlatformVerdictRecordedParams,
} from "api-server-api";

export type AcpUpdate =
  | SessionUpdate
  | ({ sessionUpdate: "platform_turn_ended" } & PlatformTurnEndedParams)
  | ({
      sessionUpdate: "platform_prompt_accepted";
    } & PlatformPromptAcceptedParams)
  | ({ sessionUpdate: "platform_prompt_started" } & PlatformPromptStartedParams)
  | ({ sessionUpdate: "platform_run_started" } & PlatformRunStartedParams)
  | ({
      sessionUpdate: "platform_sender_recorded";
    } & PlatformSenderRecordedParams)
  | ({ sessionUpdate: "platform_turn_started" } & PlatformTurnStartedParams)
  | ({
      sessionUpdate: "platform_verdict_recorded";
    } & PlatformVerdictRecordedParams)
  | ({ sessionUpdate: "platform_queue_changed" } & PlatformQueueChangedParams)
  | ({ sessionUpdate: "platform_session_reset" } & PlatformSessionResetParams)
  | { sessionUpdate: "platform_clipped_replay"; older?: string };

export interface FrameMeta {
  replayFor?: string;
  at?: string;
  telemetryPromptId?: string;
  model?: string;
  turnId?: string;
  stopReason?: string;
  block?: number;
}

export type UpdateHandler = (
  update: AcpUpdate,
  sessionId: string,
  frame?: FrameMeta,
) => void;
