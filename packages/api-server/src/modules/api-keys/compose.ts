import type { Db } from "db";
import type { ApiKeysService } from "api-server-api";
import {
  activeApiKeyIds,
  deleteApiKeyRevocation,
  findActiveApiKeyByHash,
  insertApiKey,
  insertApiKeyRevocation,
  listApiKeyRevocations,
  listApiKeysByOwner,
  listScopedAgentIds,
  removeAgentIdFromScopes,
  revokeApiKey,
  touchApiKeyLastUsed,
} from "./infrastructure/api-keys-repository.js";
import {
  createApiKeyValidator,
  type ApiKeyValidator,
} from "./services/api-key-validator.js";
import { createApiKeysService } from "./services/api-keys-service.js";
import {
  createOwnerActiveProbe,
  type OwnerActiveState,
  type OwnerDirectoryPort,
} from "./services/owner-active-probe.js";
import { createApiKeyTokenCodec } from "./domain/token.js";

export function composeApiKeysModule(deps: {
  db: Db;
  hmacKey: string;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
  ownerDirectory: OwnerDirectoryPort;
}): {
  validator: ApiKeyValidator;
  verifyOwnerActive: (sub: string) => Promise<OwnerActiveState>;
  createService: (perRequest: {
    ownerSub: string;
    surface: string;
  }) => ApiKeysService;
  activeKeyIds: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
  deferRevocation: (keyId: string, ownerSub: string) => Promise<void>;
  sweepRevocations: () => Promise<number>;
} {
  const { db, hmacKey, isAgentOwnedBy } = deps;
  const codec = createApiKeyTokenCodec(hmacKey);
  const list = listApiKeysByOwner(db);
  const insert = insertApiKey(db);
  const revoke = revokeApiKey(db);

  const validator = createApiKeyValidator({
    hashToken: codec.hash,
    findByHash: findActiveApiKeyByHash(db),
    touchLastUsed: touchApiKeyLastUsed(db),
  });

  const activeKeys = activeApiKeyIds(db);
  const insertRevocation = insertApiKeyRevocation(db);
  const listRevocations = listApiKeyRevocations(db);
  const deleteRevocation = deleteApiKeyRevocation(db);

  return {
    validator,
    verifyOwnerActive: createOwnerActiveProbe({
      directory: deps.ownerDirectory,
    }),
    activeKeyIds: activeKeys,
    deferRevocation: insertRevocation,
    /* UNIT_BOUNDARY_DESCRIPTION: revokes every key a request gave up on, and drops the record once the key cannot be used any more, so a key the platform could not revoke at the time does not stay live under a name nothing holds. */
    async sweepRevocations() {
      const pending = await listRevocations();
      let revoked = 0;
      for (const rec of pending) {
        await revoke(rec.keyId, rec.ownerSub);
        await deleteRevocation(rec.keyId);
        revoked += 1;
      }
      return revoked;
    },
    createService: ({ ownerSub, surface }) =>
      createApiKeysService({
        ownerSub,
        surface,
        list,
        insert,
        revoke,
        mintToken: codec.mint,
        isAgentOwnedBy,
      }),
  };
}

export function createApiKeysCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  return removeAgentIdFromScopes(db);
}

export function listApiKeyAgentIds(db: Db): Promise<string[]> {
  return listScopedAgentIds(db)();
}
