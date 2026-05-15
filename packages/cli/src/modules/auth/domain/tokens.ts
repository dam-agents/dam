/**
 * Discriminated shape of `POST <token_endpoint>` responses.
 *
 * The token endpoint returns one of two body shapes:
 *
 * - 2xx with `access_token`, `refresh_token`, `expires_in`, `token_type`.
 * - 4xx with `error` and (optionally) `error_description`.
 *
 * The HTTP client parses both via a `zod` discriminated union and forwards
 * the result to the state machine (issue 4) and the TokenProvider (issue 5),
 * which decide what is terminal. Modeling the union in the domain layer
 * keeps both layers honest — neither falls back to `as`-casts.
 */

export interface TokenSuccessBody {
  kind: "success";
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * OAuth 2.0 error codes the CLI cares about (RFC 8628 + RFC 6749). Any
 * other `error` value is allowed through as a string so the state machine
 * can surface it as an `unexpected-response` failure rather than crashing
 * on an unknown literal.
 */
export type OAuthErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_client"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | (string & {});

export interface TokenErrorBody {
  kind: "error";
  error: OAuthErrorCode;
  error_description?: string;
}

export type TokenEndpointResponse = TokenSuccessBody | TokenErrorBody;
