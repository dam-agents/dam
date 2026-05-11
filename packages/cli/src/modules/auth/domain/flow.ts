/**
 * Pure decision function for the RFC 8628 device-flow polling loop.
 *
 * The loop, the sleeps, and the HTTP calls live in application/infrastructure
 * (issue 6). This file owns the rules: given the latest token-endpoint
 * response plus a clock, decide whether to keep polling, succeed, or fail.
 *
 * Zero I/O. No `Date.now()`, no `setTimeout`. Times are parameters so the
 * test suite can drive the function deterministically.
 */

import type { TokenEndpointResponse } from "./tokens.js";

export type DeviceFlowFailure =
  | "access-denied"
  | "expired-token"
  | "unexpected-response";

export interface SucceededTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds. Forwarded verbatim from the token-endpoint response. */
  expiresIn: number;
  /** Forwarded verbatim. Real Keycloak emits `Bearer`. */
  tokenType: string;
}

export type FlowStep =
  | { action: "poll-again"; intervalSeconds: number }
  | { action: "succeed"; tokens: SucceededTokens }
  | { action: "fail"; reason: DeviceFlowFailure; message?: string };

export interface FlowInput {
  /** The latest body received from `POST <token_endpoint>` — either a
   *  success body with token fields or an OAuth-error body with `error`
   *  and (optionally) `error_description`. The token-endpoint-client parses
   *  both shapes via a `zod` discriminated union before handing it here. */
  response: TokenEndpointResponse;
  /** The interval the device-authorization response advertised, possibly
   *  bumped by prior `slow_down` responses. The state machine returns
   *  this verbatim on `authorization_pending` and bumps it by 5 on
   *  `slow_down` (RFC 8628 §3.5). */
  currentIntervalSeconds: number;
  /** When the device-authorization request originally succeeded. */
  startedAt: Date;
  now: Date;
  /** The device-authorization response's `expires_in`. The orchestrator
   *  also relies on the server's `expired_token` error, but checking
   *  here first short-circuits the cases where the IdP keeps responding
   *  `authorization_pending` past expiry. */
  expiresInSeconds: number;
}

/**
 * RFC 8628 §3.5:
 * - `authorization_pending` → keep polling at current interval.
 * - `slow_down` → keep polling, but +5s to the interval.
 * - `access_denied` → terminal failure.
 * - `expired_token` → terminal failure.
 * - 200 (success body) → terminal success.
 *
 * Plus a client-side timeout pre-check: if `now - startedAt >= expires_in`,
 * fail with `expired-token` even before consulting the response — the
 * device code is no longer valid and further polling cannot succeed.
 */
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
        message: input.response.error_description
          ?? `unrecognized OAuth error: ${input.response.error}`,
      };
  }
}
