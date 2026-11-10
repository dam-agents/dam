import type { Db } from "db";
import type { ApiKeysService } from "api-server-api";
import {
  activeApiKeyIds,
  deleteApiKeyRevocation,
  deleteApiKeyRevocationsForConnection,
  findActiveApiKeyByHash,
  insertApiKey,
  insertApiKeyRevocation,
  isApiKeyNamedByAConnection,
  listApiKeyRevocations,
  listApiKeyRevocationsForConnection,
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

/* UNIT_BOUNDARY_DESCRIPTION: the record a key is written to before anything uses it, and removed from once a Connection names it. An entry means the key is not a Connection's and must be revoked; the sweep reads it that way, which is what makes a crash between minting and recording cost a key rather than leave one live. */
export interface ApiKeyLedger {
  queue(keyId: string, connectionId: string): Promise<void>;
  settle(keyId: string): Promise<void>;
  pendingFor(connectionId: string): Promise<string[]>;
  forget(connectionId: string): Promise<void>;
}

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
  keyLedger: (ownerSub: string) => ApiKeyLedger;
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
  const listForConnection = listApiKeyRevocationsForConnection(db);
  const deleteForConnection = deleteApiKeyRevocationsForConnection(db);
  const namedByAConnection = isApiKeyNamedByAConnection(db);

  return {
    validator,
    verifyOwnerActive: createOwnerActiveProbe({
      directory: deps.ownerDirectory,
    }),
    activeKeyIds: activeKeys,
    keyLedger: (ownerSub) => ({
      queue: (keyId, connectionId) =>
        insertRevocation(keyId, ownerSub, connectionId),
      settle: (keyId) => deleteRevocation(keyId),
      pendingFor: listForConnection,
      forget: deleteForConnection,
    }),
    /* UNIT_BOUNDARY_DESCRIPTION: revokes every queued key no Connection names, and drops every record it has settled, so a key the platform could not revoke at the time does not stay live under a name nothing holds, and one a Connection did take over is not revoked for having been queued first. */
    async sweepRevocations() {
      const pending = await listRevocations();
      let revoked = 0;
      for (const rec of pending) {
        if (!(await namedByAConnection(rec.keyId))) {
          await revoke(rec.keyId, rec.ownerSub);
          revoked += 1;
        }
        await deleteRevocation(rec.keyId);
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
