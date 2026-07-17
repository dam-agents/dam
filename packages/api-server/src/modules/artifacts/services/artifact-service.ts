import { TRPCError } from "@trpc/server";

import type {
  Artifact,
  ArtifactStat,
  ArtifactStore,
} from "../domain/artifact-store.js";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Wraps the storage port with the one policy this module owns: the size cap
 *  — enforced up front on the relay path, post-upload on the direct path. */
export interface ArtifactService {
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Artifact | null>;
  /** Streaming read for relay paths — bytes never accumulate in the heap. */
  getStream(key: string): ReturnType<ArtifactStore["getStream"]>;
  exists(key: string): Promise<boolean>;
  /** Missing is not an error. */
  delete(key: string): Promise<void>;
  readonly maxBytes: number;
  /** null when no object store is configured — callers relay instead. */
  createUploadUrl(
    key: string,
  ): Promise<{ url: string; expiresSeconds: number } | null>;
  /** Validate a direct upload before it becomes a Candidate; an oversized
   *  object is deleted and rejected. */
  verifyUpload(key: string): Promise<ArtifactStat>;
  /** null when the blob can't be served directly — callers relay instead. */
  createDownloadUrl(key: string, filename: string): Promise<string | null>;
}

export function createArtifactService(deps: {
  store: ArtifactStore;
  maxBytes: number;
}): ArtifactService {
  return {
    maxBytes: deps.maxBytes,

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
    getStream: (key) => deps.store.getStream(key),
    exists: (key) => deps.store.exists(key),
    delete: (key) => deps.store.delete(key),

    async createUploadUrl(key) {
      const url = await deps.store.presignUpload(key, {
        expiresSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      return url ? { url, expiresSeconds: UPLOAD_URL_TTL_SECONDS } : null;
    },

    async verifyUpload(key) {
      const stat = await deps.store.head(key);
      if (!stat) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No uploaded candidate found at the given reference — upload the file first (the link may have expired).`,
        });
      }
      if (stat.sizeBytes > deps.maxBytes) {
        // A presigned PUT bounds the key but not the size — enforce here.
        await deps.store.delete(key);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Uploaded candidate exceeds the maximum size of ${deps.maxBytes} bytes (got ${stat.sizeBytes}); it has been discarded.`,
        });
      }
      return stat;
    },

    createDownloadUrl(key, filename) {
      return deps.store.presignDownload(key, {
        filename,
        expiresSeconds: DOWNLOAD_URL_TTL_SECONDS,
      });
    },
  };
}
