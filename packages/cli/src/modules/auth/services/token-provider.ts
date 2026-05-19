import { err, ok, type Result } from "../../../result.js";
import type { HostAuth } from "../domain/host-auth.js";
import { isWithinRefreshBuffer } from "../domain/host-auth.js";
import type { TokenProviderError } from "../domain/errors.js";
import type { AuthStore, HostUrl } from "../infrastructure/auth-store.js";
import type { AuthEnvReader } from "../infrastructure/auth-env-reader.js";
import type { TokenEndpointClient } from "../infrastructure/token-endpoint-client.js";

/**
 * Seconds before `expiresAt` at which Token Provider proactively refreshes.
 * Centralized so the boundary appears exactly once — off-by-one regressions
 * are easy to introduce and silent in manual testing.
 */
export const REFRESH_BUFFER_SECONDS = 60;

export interface TokenProvider {
  /**
   * Resolve a bearer for `host`. Precedence:
   *   1. `DAM_TOKEN` env var, returned as-is.
   *   2. Auth Store entry for `host`, refreshed if within the 60s buffer.
   *   3. `not-logged-in` error.
   *
   * Never logs the token. Never inspects a `DAM_TOKEN`-supplied value.
   */
  getValidAccessToken(
    host: HostUrl,
  ): Promise<Result<string, TokenProviderError>>;
}

/** Resolves the token endpoint for a host via OIDC discovery. The
 *  `cliClientId` used at refresh is read from the stored HostAuth, not
 *  re-probed here — see `auth-service.ts` for the login-time persist. */
export interface HostMetadataResolver {
  resolve(
    host: HostUrl,
  ): Promise<
    Result<
      { tokenEndpoint: string },
      { kind: "refresh-failed"; host: HostUrl; reason: string }
    >
  >;
}

export interface TokenProviderDeps {
  authStore: AuthStore;
  authEnvReader: AuthEnvReader;
  tokenEndpointClient: TokenEndpointClient;
  hostMetadata: HostMetadataResolver;
  /** Clock injection — proactive-refresh boundary lives at exactly 60s,
   *  which is too easy to flake with `Date.now()`. Defaults to wall clock. */
  now?: () => Date;
  /** Override the proactive refresh buffer (seconds). Defaults to 60. */
  refreshBufferSeconds?: number;
}

export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  const now = deps.now ?? (() => new Date());
  const bufferSeconds = deps.refreshBufferSeconds ?? REFRESH_BUFFER_SECONDS;

  return {
    async getValidAccessToken(host) {
      // 1. DAM_TOKEN precedence. Empty-string handling lives in the reader.
      const envToken = deps.authEnvReader.damToken();
      if (envToken !== undefined) return ok(envToken);

      // 2. Auth Store lookup.
      const stored = await deps.authStore.read();
      if (!stored.ok) return stored;
      const hostAuth = stored.value.get(host);
      if (!hostAuth) return err({ kind: "not-logged-in", host });

      // 3. Validity check. If outside the refresh buffer, return as-is.
      if (!isWithinRefreshBuffer(hostAuth, now(), bufferSeconds)) {
        return ok(hostAuth.accessToken);
      }

      // 4. Refresh.
      const metaResult = await deps.hostMetadata.resolve(host);
      if (!metaResult.ok) return err(metaResult.error);

      const refreshResult = await deps.tokenEndpointClient.refresh({
        tokenEndpoint: metaResult.value.tokenEndpoint,
        clientId: hostAuth.cliClientId,
        refreshToken: hostAuth.refreshToken,
      });

      // Transport-level failure: do NOT clear creds; surface as transient.
      if (!refreshResult.ok) {
        return err({
          kind: "refresh-transient",
          host,
          reason: refreshResult.error.reason,
        });
      }

      const body = refreshResult.value;
      if (body.kind === "error") {
        if (body.error === "invalid_grant") {
          // Refresh token irrecoverable — clear the host's entry so the
          // user is prompted to re-login. Auth-store write failures here
          // bubble up unchanged; they're rare and worth surfacing.
          const removed = await deps.authStore.remove(host);
          if (!removed.ok) return removed;
          return err({ kind: "session-expired", host });
        }
        // Other OAuth-level errors (`unauthorized_client`, etc.) — keep
        // creds intact so the user can retry once the server side is fixed.
        return err({
          kind: "refresh-failed",
          host,
          reason: body.error_description
            ? `${body.error}: ${body.error_description}`
            : body.error,
        });
      }

      // 200 success — persist rotated tokens atomically and return the new
      // access token. The IdP has already invalidated the old refresh
      // token; if we lose this write, the next refresh will fail and the
      // user is forced to re-login. Retry once on transient write
      // failures (e.g. EEXIST on the tmp file from a concurrent process,
      // or a flaky filesystem) before surfacing the error.
      const newAuth: HostAuth = {
        issuer: hostAuth.issuer,
        username: hostAuth.username,
        sub: hostAuth.sub,
        cliClientId: hostAuth.cliClientId,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: new Date(now().getTime() + body.expires_in * 1000),
      };
      let written = await deps.authStore.write(host, newAuth);
      if (!written.ok) {
        written = await deps.authStore.write(host, newAuth);
      }
      if (!written.ok) return written;
      return ok(body.access_token);
    },
  };
}
