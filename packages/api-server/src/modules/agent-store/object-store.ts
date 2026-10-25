import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface ObjectStoreSettings {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string } | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the gate's read of the archive the switch copied
 * to the object store, addressed by the reference the absorb recorded.
 *
 * A copy the platform cannot read now is not a second copy: the gate refuses
 * rather than fall back to the database it is about to stop reading from, so
 * every failure here is a null and never an empty buffer.
 */
export function createObjectStoreReader(
  settings: ObjectStoreSettings,
): (ref: string) => Promise<Buffer | null> {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(settings.credentials ? { credentials: settings.credentials } : {}),
  });
  const prefix = `s3://${settings.bucket}/`;
  return async (ref) => {
    if (!ref.startsWith(prefix)) return null;
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: settings.bucket,
          Key: ref.slice(prefix.length),
        }),
      );
      if (!object.Body) return null;
      return Buffer.from(await object.Body.transformToByteArray());
    } catch {
      return null;
    }
  };
}
