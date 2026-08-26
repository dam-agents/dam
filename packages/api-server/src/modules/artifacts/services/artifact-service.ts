import { TRPCError } from "@trpc/server";

import type {
  Artifact,
  ArtifactStat,
  ArtifactStore,
} from "../domain/artifact-store.js";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;
const AGENT_DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

export interface ArtifactService {
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Artifact | null>;
  getStream(key: string): ReturnType<ArtifactStore["getStream"]>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  readonly maxBytes: number;
  createUploadUrl(
    key: string,
    opts?: { contentLengthBytes?: number },
  ): Promise<{ url: string; expiresSeconds: number } | null>;
  verifyUpload(key: string): Promise<ArtifactStat>;
  stat(key: string): Promise<ArtifactStat | null>;
  createDownloadUrl(key: string, filename: string): Promise<string | null>;
  createAgentDownloadUrl(
    key: string,
    filename: string,
  ): Promise<{ url: string; expiresSeconds: number } | null>;
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

    async createUploadUrl(key, opts) {
      const url = await deps.store.presignUpload(key, {
        expiresSeconds: UPLOAD_URL_TTL_SECONDS,
        ...(opts?.contentLengthBytes !== undefined
          ? { contentLengthBytes: opts.contentLengthBytes }
          : {}),
      });
      return url ? { url, expiresSeconds: UPLOAD_URL_TTL_SECONDS } : null;
    },

    stat: (key) => deps.store.head(key),

    async verifyUpload(key) {
      const stat = await deps.store.head(key);
      if (!stat) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No uploaded candidate found at the given reference — upload the file first (the link may have expired).`,
        });
      }
      if (stat.sizeBytes > deps.maxBytes) {
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
        audience: "browser",
      });
    },

    async createAgentDownloadUrl(key, filename) {
      const url = await deps.store.presignDownload(key, {
        filename,
        expiresSeconds: AGENT_DOWNLOAD_URL_TTL_SECONDS,
        audience: "agent",
      });
      return url
        ? { url, expiresSeconds: AGENT_DOWNLOAD_URL_TTL_SECONDS }
        : null;
    },
  };
}
