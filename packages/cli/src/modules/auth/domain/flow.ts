import type { TokenEndpointResponse } from "./tokens.js";

export type DeviceFlowFailure =
  | "access-denied"
  | "expired-token"
  | "unexpected-response";

export interface SucceededTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export type FlowStep =
  | { action: "poll-again"; intervalSeconds: number }
  | { action: "succeed"; tokens: SucceededTokens }
  | { action: "fail"; reason: DeviceFlowFailure; message?: string };

export interface FlowInput {
  response: TokenEndpointResponse;
  currentIntervalSeconds: number;
  startedAt: Date;
  now: Date;
  expiresInSeconds: number;
}

export function nextFlowStep(input: FlowInput): FlowStep {
  const elapsedMs = input.now.getTime() - input.startedAt.getTime();
  if (elapsedMs >= input.expiresInSeconds * 1000) {
    return { action: "fail", reason: "expired-token" };
  }

  if (input.response.kind === "success") {
    return {
      action: "succeed",
      tokens: {
        accessToken: input.response.access_token,
        refreshToken: input.response.refresh_token,
        expiresIn: input.response.expires_in,
        tokenType: input.response.token_type,
      },
    };
  }

  switch (input.response.error) {
    case "authorization_pending":
      return {
        action: "poll-again",
        intervalSeconds: input.currentIntervalSeconds,
      };
    case "slow_down":
      return {
        action: "poll-again",
        intervalSeconds: input.currentIntervalSeconds + 5,
      };
    case "access_denied":
      return {
        action: "fail",
        reason: "access-denied",
        message: input.response.error_description,
      };
    case "expired_token":
      return {
        action: "fail",
        reason: "expired-token",
        message: input.response.error_description,
      };
    default:
      return {
        action: "fail",
        reason: "unexpected-response",
        message:
          input.response.error_description ??
          `unrecognized OAuth error: ${input.response.error}`,
      };
  }
}
