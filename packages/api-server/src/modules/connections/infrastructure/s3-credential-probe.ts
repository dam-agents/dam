import {
  HeadBucketCommand,
  ListBucketsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  S3CredentialProbe,
  S3CredentialProbeOutcome,
} from "../domain/s3-credential-probe.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const REFUSAL_NAMES = new Set([
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "AccessDenied",
  "Forbidden",
  "Unauthorized",
]);

const MISSING_BUCKET_NAMES = new Set(["NoSuchBucket", "NotFound"]);

interface SdkError {
  name?: string;
  message?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
}

function classify(err: unknown): S3CredentialProbeOutcome {
  const e = (err ?? {}) as SdkError;
  const name = e.name ?? "Error";
  const status = e.$metadata?.httpStatusCode;
  if (REFUSAL_NAMES.has(name) || status === 401 || status === 403) {
    return { ok: false, reason: "refused", detail: name };
  }
  if (MISSING_BUCKET_NAMES.has(name) || status === 404) {
    return { ok: false, reason: "no-such-bucket", detail: name };
  }
  if (status === undefined) {
    return {
      ok: false,
      reason: "unreachable",
      detail: e.code ?? e.message ?? name,
    };
  }
  return { ok: false, reason: "failed", detail: `${name} (HTTP ${status})` };
}

export function createS3CredentialProbe(
  opts: { timeoutMs?: number } = {},
): S3CredentialProbe {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async probe(input) {
      const client = new S3Client({
        endpoint: input.endpoint,
        region: input.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        maxAttempts: 1,
        requestHandler: {
          connectionTimeout: timeoutMs,
          requestTimeout: timeoutMs,
        },
      });
      try {
        if (input.bucket) {
          await client.send(new HeadBucketCommand({ Bucket: input.bucket }));
        } else {
          await client.send(new ListBucketsCommand({}));
        }
        return { ok: true };
      } catch (err) {
        return classify(err);
      } finally {
        client.destroy();
      }
    },
  };
}
