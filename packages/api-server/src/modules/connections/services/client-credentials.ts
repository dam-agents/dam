import type { ConnectionAuthConfig } from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";

// Fallback horizon when the token endpoint returns no `expires_in`: an hourly
// idempotent re-mint beats trusting the token to live forever, and a set
// `expiresAt` keeps the connection visible to the refresh loop's due query.
export const CLIENT_CREDENTIALS_DEFAULT_TTL_SECONDS = 3600;

export type ClientCredentialsAuth = Extract<
  ConnectionAuthConfig,
  { kind: "client-credentials" }
>;

/** One client_credentials exchange, shared by connection create and the
 *  refresh loop. `expiresAt` is always set (see the default TTL above). */
export async function mintClientCredentialsToken(
  engine: OAuthEngine,
  opts: {
    connectionRef: string;
    auth: ClientCredentialsAuth;
    clientSecret: string;
    now?: () => number;
  },
): Promise<{ accessToken: string; expiresAt: number }> {
  const now = opts.now ?? (() => Date.now());
  const provider: OAuthProvider = {
    id: opts.connectionRef,
    tokenEndpoint: opts.auth.tokenUrl,
    clientId: opts.auth.clientId,
    clientSecret: opts.clientSecret,
    scopes: opts.auth.scopes,
    ...(opts.auth.tokenEndpointAcceptJson
      ? { tokenEndpointAcceptJson: true }
      : {}),
  };
  const tokens = await engine.clientCredentials({
    provider,
    ...(opts.auth.audience ? { audience: opts.auth.audience } : {}),
  });
  return {
    accessToken: tokens.accessToken,
    expiresAt:
      tokens.expiresAt ??
      Math.floor(now() / 1000) + CLIENT_CREDENTIALS_DEFAULT_TTL_SECONDS,
  };
}
