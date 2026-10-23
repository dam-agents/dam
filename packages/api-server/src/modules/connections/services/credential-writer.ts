import type { Connection, ConnectionAuthConfig } from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { XactLock } from "../../../core/xact-lock.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import { withoutRefreshFailureMarker } from "../domain/refresh-failure-marker.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a Connection's credential token is
 * written. Every writer — refresh, re-mint, rotation, scope change — takes the
 * Connection's lock, re-reads the row, and stands down when the auth kind
 * moved since the caller read it. A writer that renews a token from the state
 * itself also stands down when that state's expiry moved, so a spent refresh
 * token is not presented twice; a writer acting on a user's new secret asks
 * for the kind only, because the user's replacement must reach the store.
 */
export type TokenAuth = Extract<
  ConnectionAuthConfig,
  { kind: "oauth" | "client-credentials" | "github-app" }
>;

export interface CredentialWriterDeps {
  repo: Pick<ConnectionsRepository, "getById" | "updateAuth">;
  secretStore: SecretStore;
  connectionLock: XactLock;
  lockKey: string;
  standDownOnKindChangeOnly?: boolean;
}

export function isTokenAuth(auth: ConnectionAuthConfig): auth is TokenAuth {
  return (
    auth.kind === "oauth" ||
    auth.kind === "client-credentials" ||
    auth.kind === "github-app"
  );
}

export async function writeToken(
  secretStore: SecretStore,
  fresh: Connection,
  auth: TokenAuth,
  token: string,
  fields: Record<string, string> = {},
): Promise<void> {
  await secretStore.putFields(auth.accessTokenRef, {
    ...fields,
    access_token: token,
    ...buildConnectionSdsFields(fresh.contributions, token),
  });
}

export function renewedAuth<A extends TokenAuth>(
  auth: A,
  expiresAt?: number,
): A {
  return { ...withoutRefreshFailureMarker(auth), expiresAt };
}

export async function mintUnderLock<A extends TokenAuth>(
  conn: Connection,
  auth: A,
  deps: CredentialWriterDeps,
  mint: (fresh: Connection, freshAuth: A) => Promise<A>,
): Promise<void> {
  await deps.connectionLock(deps.lockKey, async () => {
    const fresh = await deps.repo.getById(conn.id);
    if (!fresh) return;
    const freshAuth = fresh.auth;
    if (
      !isTokenAuth(freshAuth) ||
      freshAuth.kind !== auth.kind ||
      (!deps.standDownOnKindChangeOnly &&
        freshAuth.expiresAt !== auth.expiresAt)
    ) {
      return;
    }
    await deps.repo.updateAuth(conn.id, await mint(fresh, freshAuth as A));
  });
}
