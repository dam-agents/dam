import type { Scope } from "api-server-api";
import { err, ok, type Result } from "../../../core/result.js";
import type { ApiKeyRow } from "../domain/types.js";

export interface ValidatedApiKey {
  id: string;
  ownerSub: string;
  scopes: readonly Scope[];
  agentIds: readonly string[] | "*";
}

export type ApiKeyValidationFailure = "unknown" | "expired" | "revoked";

export interface ApiKeyValidatorDeps {
  /** Computes the at-rest digest of an incoming token (HMAC-SHA256 with the
   *  server pepper). Injected so the validator stays free of key material. */
  hashToken: (token: string) => string;
  findByHash: (hash: string) => Promise<ApiKeyRow | null>;
  touchLastUsed: (id: string) => Promise<void>;
}

export type ApiKeyValidator = (
  token: string,
) => Promise<Result<ValidatedApiKey, ApiKeyValidationFailure>>;

export function createApiKeyValidator(
  deps: ApiKeyValidatorDeps,
): ApiKeyValidator {
  return async (token) => {
    const hash = deps.hashToken(token);
    const row = await deps.findByHash(hash);
    if (!row) return err("unknown");
    if (row.revokedAt) return err("revoked");
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return err("expired");
    }

    // last_used_at is observability, not authorization — a write failure
    // must not break a legitimate request.
    void deps.touchLastUsed(row.id).catch(() => {});

    return ok({
      id: row.id,
      ownerSub: row.ownerSub,
      scopes: row.scopes,
      agentIds: row.agentIds === null ? "*" : row.agentIds,
    });
  };
}
