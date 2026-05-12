import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { TokenTransportError } from "../domain/errors.js";
import type { TokenEndpointResponse } from "../domain/tokens.js";

export interface TokenEndpointClient {
  /** OAuth 2.0 Device Authorization Grant token exchange. */
  exchangeDeviceCode(input: {
    tokenEndpoint: string;
    clientId: string;
    deviceCode: string;
  }): Promise<Result<TokenEndpointResponse, TokenTransportError>>;
  /** Refresh-token grant — reused by the TokenProvider (issue 5). */
  refresh(input: {
    tokenEndpoint: string;
    clientId: string;
    refreshToken: string;
  }): Promise<Result<TokenEndpointResponse, TokenTransportError>>;
}

export interface HttpTokenEndpointClientOpts {
  timeoutMs?: number;
}

const successSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
});

const oauthErrorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function classify(
  raw: unknown,
): Result<TokenEndpointResponse, TokenTransportError> {
  // The shapes are disjoint — success bodies carry `access_token`, error
  // bodies carry `error`. Try success first because the happy path is the
  // most common; fall through to error parsing otherwise. A response that
  // matches neither (or is not a JSON object at all) is treated as a
  // transport-level failure — the state machine never sees it.
  const success = successSchema.safeParse(raw);
  if (success.success) {
    return ok({ kind: "success", ...success.data });
  }
  const errorBody = oauthErrorSchema.safeParse(raw);
  if (errorBody.success) {
    return ok({
      kind: "error",
      error: errorBody.data.error,
      error_description: errorBody.data.error_description,
    });
  }
  return err({
    kind: "token-transport",
    reason: `token endpoint returned an unparseable body: ${JSON.stringify(raw)}`,
  });
}

async function postTokenEndpoint(
  tokenEndpoint: string,
  body: URLSearchParams,
  timeoutMs: number,
): Promise<Result<TokenEndpointResponse, TokenTransportError>> {
  let res: Response;
  try {
    res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return err({ kind: "token-transport", reason: errorMessage(e) });
  }

  // The token endpoint returns 4xx for OAuth-level errors with a body we
  // want to forward to the state machine. 5xx and other ranges are real
  // transport failures — no useful OAuth error body to parse.
  if (res.status >= 500) {
    return err({
      kind: "token-transport",
      reason: `token endpoint returned ${res.status} ${res.statusText || "(no status text)"}`,
    });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    return err({
      kind: "token-transport",
      reason: `token endpoint body is not JSON: ${errorMessage(e)}`,
    });
  }

  return classify(raw);
}

export function createTokenEndpointClient(
  opts: HttpTokenEndpointClientOpts = {},
): TokenEndpointClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return {
    async exchangeDeviceCode({ tokenEndpoint, clientId, deviceCode }) {
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceCode,
      });
      return postTokenEndpoint(tokenEndpoint, body, timeoutMs);
    },

    async refresh({ tokenEndpoint, clientId, refreshToken }) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      });
      return postTokenEndpoint(tokenEndpoint, body, timeoutMs);
    },
  };
}
