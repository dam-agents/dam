import { formatError } from "../../../core/format-error.js";

const GRANT_TIMEOUT_MS = 10_000;
const DEAD_CREDENTIAL = new Set([
  "invalid_refresh_token",
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
]);

export interface SlackRotatingToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type SlackTokenGrantResult =
  | ({ ok: true } & SlackRotatingToken)
  | { ok: false; credentialDead: boolean; error: string };

export type SlackTokenGrant = (token: string) => Promise<SlackTokenGrantResult>;

export interface SlackTokenRotation {
  refresh: SlackTokenGrant;
  exchange: SlackTokenGrant;
  now(): number;
}

const unavailable: SlackTokenGrant = async () => ({
  ok: false,
  credentialDead: false,
  error: "slack-client-credentials-missing",
});

export const noSlackTokenRotation: SlackTokenRotation = {
  refresh: unavailable,
  exchange: unavailable,
  now: () => Date.now(),
};

interface SlackGrantResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export function rotatingTokenFrom(
  response: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  },
  now: number,
): SlackRotatingToken | null {
  const { access_token, refresh_token, expires_in } = response;
  if (!access_token || !refresh_token || typeof expires_in !== "number") {
    return null;
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: now + expires_in * 1000,
  };
}

export function createSlackTokenRotation(creds: {
  clientId: string;
  clientSecret: string;
  now?: () => number;
}): SlackTokenRotation {
  const now = creds.now ?? (() => Date.now());

  async function grant(
    method: string,
    params: Record<string, string>,
  ): Promise<SlackTokenGrantResult> {
    let body: SlackGrantResponse;
    try {
      const res = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...params,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
        }),
      });
      body = (await res.json()) as SlackGrantResponse;
    } catch (err) {
      return { ok: false, credentialDead: false, error: formatError(err) };
    }
    if (!body.ok) {
      const refusal = body.error ?? "unknown";
      return {
        ok: false,
        credentialDead: DEAD_CREDENTIAL.has(refusal),
        error: refusal,
      };
    }
    const token = rotatingTokenFrom(body, now());
    if (!token) {
      return {
        ok: false,
        credentialDead: false,
        error: "incomplete-grant-response",
      };
    }
    return { ok: true, ...token };
  }

  return {
    refresh: (refreshToken) =>
      grant("oauth.v2.access", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    exchange: (longLivedToken) =>
      grant("oauth.v2.exchange", { token: longLivedToken }),
    now,
  };
}
