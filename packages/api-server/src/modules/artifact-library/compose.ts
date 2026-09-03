import type { Db } from "db";
import type { Redis } from "ioredis";
import { createRemoteJWKSet } from "jose";

import { createRedisTtlStore } from "../../core/ttl-store.js";
import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import {
  SHARE_LOGIN_TTL_MS,
  SHARE_SESSION_TTL_MS,
} from "./domain/share-session.js";
import { createArtifactLibraryRepository } from "./infrastructure/artifact-library-repository.js";
import {
  createKeycloakShareIdentity,
  keycloakShareJwksUrl,
} from "./infrastructure/keycloak-share-identity.js";
import {
  createArtifactLibraryService,
  type ArtifactLibraryServiceImpl,
} from "./services/artifact-library-service.js";
import {
  createArtifactExpirySweeper,
  type ArtifactExpirySweeper,
} from "./services/expiry-sweeper.js";
import {
  createShareAuthService,
  type ShareAuthService,
} from "./services/share-auth-service.js";
import {
  createShareViewerService,
  type ShareViewerService,
} from "./services/share-viewer-service.js";

export interface ComposeArtifactLibraryForOwnerOpts {
  db: Db;
  artifacts: ArtifactService;
  owner: string;
  surface: string;
  shareBaseUrl: string;
}

export function composeArtifactLibraryForOwner(
  opts: ComposeArtifactLibraryForOwnerOpts,
): { artifactLibrary: ArtifactLibraryServiceImpl } {
  return {
    artifactLibrary: createArtifactLibraryService({
      repo: createArtifactLibraryRepository(opts.db),
      artifacts: opts.artifacts,
      owner: opts.owner,
      surface: opts.surface,
      shareBaseUrl: opts.shareBaseUrl,
    }),
  };
}

export function composeShareViewer(opts: {
  db: Db;
  artifacts: ArtifactService;
}): ShareViewerService {
  return createShareViewerService({
    repo: createArtifactLibraryRepository(opts.db),
    artifacts: opts.artifacts,
  });
}

export function composeArtifactExpirySweeper(opts: {
  db: Db;
  artifacts: ArtifactService;
  batchSize: number;
}): ArtifactExpirySweeper {
  return createArtifactExpirySweeper({
    repo: createArtifactLibraryRepository(opts.db),
    artifacts: opts.artifacts,
    batchSize: opts.batchSize,
  });
}

export interface ComposeShareAuthOpts {
  redis: Redis;
  keycloak: {
    externalUrl: string;
    internalUrl: string;
    realm: string;
    clientId: string;
  };
  shareBaseUrl: string;
}

export function composeShareAuth(opts: ComposeShareAuthOpts): ShareAuthService {
  const shareBase = opts.shareBaseUrl.replace(/\/+$/, "");
  const keycloak = {
    keycloakExternalUrl: opts.keycloak.externalUrl,
    keycloakUrl: opts.keycloak.internalUrl,
    realm: opts.keycloak.realm,
  };
  return createShareAuthService({
    provider: createKeycloakShareIdentity(
      {
        ...keycloak,
        clientId: opts.keycloak.clientId,
        callbackUrl: `${shareBase}/auth/callback`,
      },
      {
        fetch: globalThis.fetch,
        idTokenKey: createRemoteJWKSet(keycloakShareJwksUrl(keycloak)),
      },
    ),
    pending: createRedisTtlStore(opts.redis, "share:login", SHARE_LOGIN_TTL_MS),
    sessions: createRedisTtlStore(
      opts.redis,
      "share:session",
      SHARE_SESSION_TTL_MS,
    ),
    shareBaseUrl: shareBase,
    now: () => Date.now(),
  });
}
