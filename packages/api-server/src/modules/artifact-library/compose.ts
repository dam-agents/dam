import type { Db } from "db";

import type { ArtifactService } from "../artifacts/services/artifact-service.js";
import { createArtifactLibraryRepository } from "./infrastructure/artifact-library-repository.js";
import {
  createArtifactLibraryService,
  type ArtifactLibraryServiceImpl,
} from "./services/artifact-library-service.js";
import {
  createArtifactExpirySweeper,
  type ArtifactExpirySweeper,
} from "./services/expiry-sweeper.js";
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
