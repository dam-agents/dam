import { TRPCError } from "@trpc/server";

import type { Artifact, ArtifactStore } from "../domain/artifact-store.js";

/** The public artifact API. Wraps the storage port with the only policy this
 *  module owns: a hard size cap, enforced before the blob reaches storage so an
 *  oversized Candidate can't bloat the database. */
export interface ArtifactService {
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Artifact | null>;
  exists(key: string): Promise<boolean>;
}

export function createArtifactService(deps: {
  store: ArtifactStore;
  maxBytes: number;
}): ArtifactService {
  return {
    async put(input) {
      if (input.content.byteLength > deps.maxBytes) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Candidate exceeds the maximum size of ${deps.maxBytes} bytes (got ${input.content.byteLength}).`,
        });
      }
      await deps.store.put(input);
    },
    get: (key) => deps.store.get(key),
    exists: (key) => deps.store.exists(key),
  };
}
