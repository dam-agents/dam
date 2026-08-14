import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

import {
  createS3ArtifactStore,
  ensureBucket,
} from "./infrastructure/s3-artifact-store.js";
import { createUnconfiguredArtifactStore } from "./infrastructure/unconfigured-artifact-store.js";
import type { ArtifactService } from "./services/artifact-service.js";
import { createArtifactService } from "./services/artifact-service.js";

export interface ObjectStorageConfig {
  endpoint: string;
  agentEndpoint: string;
  publicEndpoint: string | null;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string } | null;
}

export interface ComposeArtifactsDeps {
  maxBytes: number;
  objectStorage: ObjectStorageConfig | null;
}

export function composeArtifactsModule(deps: ComposeArtifactsDeps): {
  service: ArtifactService;
  ensureReady: () => Promise<void>;
} {
  if (!deps.objectStorage) {
    const service = createArtifactService({
      store: createUnconfiguredArtifactStore(),
      maxBytes: deps.maxBytes,
    });
    return { service, ensureReady: () => Promise.resolve() };
  }

  const { endpoint, agentEndpoint, publicEndpoint, ...common } =
    deps.objectStorage;
  const clientConfig = (ep: string): S3ClientConfig => ({
    endpoint: ep,
    region: common.region,
    forcePathStyle: common.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(common.credentials ? { credentials: common.credentials } : {}),
  });
  const client = new S3Client(clientConfig(endpoint));
  const store = createS3ArtifactStore({
    client,
    bucket: common.bucket,
    agentSigner:
      agentEndpoint === endpoint
        ? client
        : new S3Client(clientConfig(agentEndpoint)),
    browserSigner: publicEndpoint
      ? publicEndpoint === endpoint
        ? client
        : new S3Client(clientConfig(publicEndpoint))
      : null,
  });
  const service = createArtifactService({ store, maxBytes: deps.maxBytes });
  return { service, ensureReady: () => ensureBucket(client, common.bucket) };
}
