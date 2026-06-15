import type { Db } from "db";
import type { ApiKeysService } from "api-server-api";
import {
  findActiveApiKeyByHash,
  insertApiKey,
  listApiKeysByOwner,
  revokeApiKey,
  touchApiKeyLastUsed,
} from "./infrastructure/api-keys-repository.js";
import {
  createApiKeyValidator,
  type ApiKeyValidator,
} from "./services/api-key-validator.js";
import { createApiKeysService } from "./services/api-keys-service.js";

/**
 * System-level wiring — the validator is shared across all requests
 * (looked up by hash, no per-user state). The service factory is
 * per-request because it carries `ownerSub` and `callerKeyId` from
 * the authenticated principal.
 */
export function composeApiKeysModule(deps: {
  db: Db;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
}): {
  validator: ApiKeyValidator;
  createService: (perRequest: {
    ownerSub: string;
    callerKeyId: string | undefined;
  }) => ApiKeysService;
} {
  const { db, isAgentOwnedBy } = deps;
  const list = listApiKeysByOwner(db);
  const insert = insertApiKey(db);
  const revoke = revokeApiKey(db);

  const validator = createApiKeyValidator({
    findByHash: findActiveApiKeyByHash(db),
    touchLastUsed: touchApiKeyLastUsed(db),
  });

  return {
    validator,
    createService: ({ ownerSub, callerKeyId }) =>
      createApiKeysService({
        ownerSub,
        callerKeyId,
        list,
        insert,
        revoke,
        isAgentOwnedBy,
      }),
  };
}
