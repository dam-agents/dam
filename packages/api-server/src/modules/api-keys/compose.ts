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
import {
  createOwnerActiveProbe,
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
  verifyOwnerActive: (sub: string) => Promise<boolean>;
  createService: (perRequest: { ownerSub: string }) => ApiKeysService;
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

  return {
    validator,
    verifyOwnerActive: createOwnerActiveProbe({
      directory: deps.ownerDirectory,
    }),
    createService: ({ ownerSub }) =>
      createApiKeysService({
        ownerSub,
        list,
        insert,
        revoke,
        mintToken: codec.mint,
        isAgentOwnedBy,
      }),
  };
}
