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
  /** Shared blob-store service (owner-agnostic); this module owner-scopes
   *  every key it hands over. */
  artifacts: ArtifactService;
  owner: string;
  shareBaseUrl: string;
}

/** Owner-scoped service — backs both the user tRPC router and the in-pod MCP
 *  session (same factory, owner bound at composition, never request input). */
export function composeArtifactLibraryForOwner(
  opts: ComposeArtifactLibraryForOwnerOpts,
): { artifactLibrary: ArtifactLibraryServiceImpl } {
  return {
    artifactLibrary: createArtifactLibraryService({
      repo: createArtifactLibraryRepository(opts.db),
      artifacts: opts.artifacts,
      owner: opts.owner,
      shareBaseUrl: opts.shareBaseUrl,
    }),
  };
}

/** Owner-agnostic read surface for the public share host (slug resolution,
 *  password verification, view counting). Boot-scoped. */
export function composeShareViewer(opts: {
  db: Db;
  artifacts: ArtifactService;
}): ShareViewerService {
  return createShareViewerService({
    repo: createArtifactLibraryRepository(opts.db),
    artifacts: opts.artifacts,
  });
}

/** System-level expired-artifact reaper tick — the composition root
 *  schedules it on the platform periodic-jobs queue. */
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
