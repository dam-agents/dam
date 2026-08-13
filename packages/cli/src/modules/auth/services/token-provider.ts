import { err, ok, type Result } from "../../../result.js";
import type { HostAuth } from "../domain/host-auth.js";
import { isWithinRefreshBuffer } from "../domain/host-auth.js";
import type { TokenProviderError } from "../domain/errors.js";
import type { AuthStore, HostUrl } from "../infrastructure/auth-store.js";
import type { AuthEnvReader } from "../infrastructure/auth-env-reader.js";
import type { TokenEndpointClient } from "../infrastructure/token-endpoint-client.js";

export const REFRESH_BUFFER_SECONDS = 60;

export interface TokenProvider {
  getValidAccessToken(
    host: HostUrl,
  ): Promise<Result<string, TokenProviderError>>;
}

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
  now?: () => Date;
  refreshBufferSeconds?: number;
}

export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  const now = deps.now ?? (() => new Date());
  const bufferSeconds = deps.refreshBufferSeconds ?? REFRESH_BUFFER_SECONDS;

  return {
    async getValidAccessToken(host) {
      const envToken = deps.authEnvReader.damToken();
      if (envToken !== undefined) return ok(envToken);

      const stored = await deps.authStore.read();
      if (!stored.ok) return stored;
      const hostAuth = stored.value.get(host);
      if (!hostAuth) return err({ kind: "not-logged-in", host });

      if (!isWithinRefreshBuffer(hostAuth, now(), bufferSeconds)) {
        return ok(hostAuth.accessToken);
      }

      const metaResult = await deps.hostMetadata.resolve(host);
      if (!metaResult.ok) return err(metaResult.error);

      const refreshResult = await deps.tokenEndpointClient.refresh({
        tokenEndpoint: metaResult.value.tokenEndpoint,
        clientId: hostAuth.cliClientId,
        refreshToken: hostAuth.refreshToken,
      });

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
          const removed = await deps.authStore.remove(host);
          if (!removed.ok) return removed;
          return err({ kind: "session-expired", host });
        }
        return err({
          kind: "refresh-failed",
          host,
          reason: body.error_description
            ? `${body.error}: ${body.error_description}`
            : body.error,
        });
      }

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
