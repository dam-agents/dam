import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { TokenTransportError } from "../domain/errors.js";
import type { TokenEndpointResponse } from "../domain/tokens.js";
import { errorMessage } from "../../shared/error-message.js";

export interface TokenEndpointClient {
  exchangeDeviceCode(input: {
    tokenEndpoint: string;
    clientId: string;
    deviceCode: string;
  }): Promise<Result<TokenEndpointResponse, TokenTransportError>>;
  refresh(input: {
    tokenEndpoint: string;
    clientId: string;
    refreshToken: string;
  }): Promise<Result<TokenEndpointResponse, TokenTransportError>>;
}

const TIMEOUT_MS = 10_000;

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

function classify(
  raw: unknown,
): Result<TokenEndpointResponse, TokenTransportError> {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return err({ kind: "token-transport", reason: errorMessage(e) });
  }

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

export function createTokenEndpointClient(): TokenEndpointClient {
  return {
    async exchangeDeviceCode({ tokenEndpoint, clientId, deviceCode }) {
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceCode,
      });
      return postTokenEndpoint(tokenEndpoint, body);
    },

    async refresh({ tokenEndpoint, clientId, refreshToken }) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      });
      return postTokenEndpoint(tokenEndpoint, body);
    },
  };
}
