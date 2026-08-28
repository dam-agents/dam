import type { Db } from "db";

import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { createArtifactLibraryRepository } from "./infrastructure/artifact-library-repository.js";
import { createArtifactRequestsRepository } from "./infrastructure/artifact-requests-repository.js";
import { createArtifactRequestDelivery } from "./services/artifact-request-delivery.js";
import {
  createArtifactRequestsService,
  type ArtifactRequestsServiceImpl,
} from "./services/artifact-requests-service.js";
import {
  createArtifactLibraryService,
  type ArtifactLibraryServiceImpl,
} from "./services/artifact-library-service.js";
import {
  createArtifactExpirySweeper,
  type ArtifactExpirySweeper,
} from "./services/expiry-sweeper.js";
import {
  createArtifactRequestExpirySweeper,
  type ArtifactRequestExpirySweeper,
} from "./services/request-expiry-sweeper.js";
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
): {
  artifactLibrary: ArtifactLibraryServiceImpl;
} {
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

export interface ComposeArtifactRequestsForOwnerOpts {
  db: Db;
  artifactLibrary: ArtifactLibraryServiceImpl;
  runtimeMutator: RuntimeMutator;
  ensureAgentReady: (agentId: string) => Promise<void>;
  listAgentSessions: (
    agentId: string,
  ) => Promise<readonly { sessionId: string }[]>;
  owner: string;
  surface: string;
}

export function composeArtifactRequestsForOwner(
  opts: ComposeArtifactRequestsForOwnerOpts,
): {
  artifactRequests: ArtifactRequestsServiceImpl;
} {
  return {
    artifactRequests: createArtifactRequestsService({
      requests: createArtifactRequestsRepository(opts.db),
      library: createArtifactLibraryRepository(opts.db),
      delivery: createArtifactRequestDelivery({
        runtimeMutator: opts.runtimeMutator,
        ensureAgentReady: opts.ensureAgentReady,
        listSessions: opts.listAgentSessions,
      }),
      readPageSource: async (artifactId) => {
        const content = await opts.artifactLibrary.getContent(artifactId);
        if (!content || content.binary || content.tooLarge) return null;
        return content.content;
      },
      owner: opts.owner,
      surface: opts.surface,
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

export function composeArtifactRequestExpirySweeper(opts: {
  db: Db;
  batchSize: number;
}): ArtifactRequestExpirySweeper {
  return createArtifactRequestExpirySweeper({
    requests: createArtifactRequestsRepository(opts.db),
    batchSize: opts.batchSize,
  });
}
