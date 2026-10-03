import {
  HeadBucketCommand,
  ListBucketsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  S3CredentialProbe,
  S3ProbeOutcome,
} from "../domain/s3-credential-probe.js";

const PROBE_TIMEOUT_MS = 8000;
const REFUSAL_NAMES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "AccessDenied",
  "Forbidden",
]);

function outcomeOf(err: unknown): S3ProbeOutcome {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (
    status === 401 ||
    status === 403 ||
    (e.name !== undefined && REFUSAL_NAMES.has(e.name))
  ) {
    return "refused";
  }
  if (status === 404 || e.name === "NoSuchBucket" || e.name === "NotFound") {
    return "no-such-bucket";
  }
  return "unreachable";
}

export function createAwsS3CredentialProbe(): S3CredentialProbe {
  return {
    async verify(input) {
      const client = new S3Client({
        endpoint: input.endpoint,
        region: input.region,
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        maxAttempts: 1,
        credentials: {
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
        },
        requestHandler: {
          connectionTimeout: PROBE_TIMEOUT_MS,
          requestTimeout: PROBE_TIMEOUT_MS,
        },
      });
      try {
        if (input.bucket) {
          await client.send(new HeadBucketCommand({ Bucket: input.bucket }));
        } else {
          await client.send(new ListBucketsCommand({}));
        }
        return "ok";
      } catch (err) {
        return outcomeOf(err);
      } finally {
        client.destroy();
      }
    },
  };
}
