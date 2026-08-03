import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  Artifact,
  ArtifactStat,
  ArtifactStore,
} from "../domain/artifact-store.js";

/** S3-compatible ArtifactStore. Separate signer clients because SigV4 binds
 *  the Host header — links must be signed against the authority their
 *  audience dials (agents for uploads, browsers for downloads). No size
 *  policy here — that is the service's job. */
export function createS3ArtifactStore(deps: {
  client: S3Client;
  bucket: string;
  uploadSigner: S3Client;
  downloadSigner: S3Client | null;
}): ArtifactStore {
  async function head(key: string): Promise<ArtifactStat | null> {
    try {
      const res = await deps.client.send(
        new HeadObjectCommand({ Bucket: deps.bucket, Key: key }),
      );
      return {
        contentType: res.ContentType ?? "application/octet-stream",
        sizeBytes: res.ContentLength ?? 0,
      };
    } catch (err) {
      if (err instanceof NoSuchKey || err instanceof NotFound) return null;
      throw err;
    }
  }

  return {
    async put(input) {
      await deps.client.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: input.key,
          Body: input.content,
          ContentType: input.contentType,
        }),
      );
    },

    async get(key): Promise<Artifact | null> {
      let res;
      try {
        res = await deps.client.send(
          new GetObjectCommand({ Bucket: deps.bucket, Key: key }),
        );
      } catch (err) {
        if (err instanceof NoSuchKey || err instanceof NotFound) return null;
        throw err;
      }
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return null;
      const content = Buffer.from(bytes);
      return {
        key,
        content,
        contentType: res.ContentType ?? "application/octet-stream",
        sizeBytes: content.byteLength,
        createdAt: res.LastModified ?? new Date(),
      };
    },

    async getStream(key) {
      let res;
      try {
        res = await deps.client.send(
          new GetObjectCommand({ Bucket: deps.bucket, Key: key }),
        );
      } catch (err) {
        if (err instanceof NoSuchKey || err instanceof NotFound) return null;
        throw err;
      }
      if (!res.Body) return null;
      return {
        stream: res.Body.transformToWebStream(),
        contentType: res.ContentType ?? "application/octet-stream",
        sizeBytes: res.ContentLength ?? 0,
      };
    },

    async exists(key): Promise<boolean> {
      return (await head(key)) !== null;
    },

    head,

    async delete(key): Promise<void> {
      await deps.client.send(
        new DeleteObjectCommand({ Bucket: deps.bucket, Key: key }),
      );
    },

    presignUpload(key, opts): Promise<string | null> {
      return getSignedUrl(
        deps.uploadSigner,
        new PutObjectCommand({ Bucket: deps.bucket, Key: key }),
        { expiresIn: opts.expiresSeconds },
      );
    },

    async presignDownload(key, opts): Promise<string | null> {
      if (!deps.downloadSigner) return null;
      return getSignedUrl(
        deps.downloadSigner,
        new GetObjectCommand({
          Bucket: deps.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${opts.filename}"`,
        }),
        { expiresIn: opts.expiresSeconds },
      );
    },
  };
}

/** Create the bucket if missing. Idempotent (a concurrent create by another
 *  replica is success); run at boot so a bad store fails fast. */
export async function ensureBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    if (!(err instanceof NotFound)) throw err;
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err instanceof BucketAlreadyOwnedByYou) return;
    throw err;
  }
}
