import { TRPCError } from "@trpc/server";

import type { ArtifactStore } from "../domain/artifact-store.js";

/** Fail-closed ArtifactStore for installs with no object store configured —
 *  mirrors the disabled-telemetry PRECONDITION_FAILED pattern. Reads answer
 *  "nothing there"; writes explain what is missing. */
export function createUnconfiguredArtifactStore(): ArtifactStore {
  const unavailable = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "no object store is configured on this deployment; candidate artifacts are unavailable",
    });
  return {
    put: () => Promise.reject(unavailable()),
    get: () => Promise.resolve(null),
    getStream: () => Promise.resolve(null),
    exists: () => Promise.resolve(false),
    head: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
    presignUpload: () => Promise.resolve(null),
    presignDownload: () => Promise.resolve(null),
  };
}
