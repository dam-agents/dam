import type { Db } from "db";

import { createPostgresArtifactStore } from "./infrastructure/postgres-artifact-store.js";
import type { ArtifactService } from "./services/artifact-service.js";
import { createArtifactService } from "./services/artifact-service.js";

export interface ComposeArtifactsDeps {
  db: Db;
  maxBytes: number;
}

/** Wire the artifact store + service. Boot-time singleton (the store is
 *  owner-agnostic; call-site ownership checks land with the consumers in
 *  dam-u1n.7/.10). Not yet wired into the app root — composed when the first
 *  consumer (record_run MCP tool) arrives. */
export function composeArtifactsModule(deps: ComposeArtifactsDeps): {
  service: ArtifactService;
} {
  const store = createPostgresArtifactStore(deps.db);
  const service = createArtifactService({
    store,
    maxBytes: deps.maxBytes,
  });
  return { service };
}
