import { isIpLiteral } from "./kubernetes-contributions.js";

export class S3InputError extends Error {}

export interface S3Endpoint {
  host: string;
  port?: number;
  origin: string;
}

const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const KEY_TEXT = /^[\x21-\x7e]+$/;

export function parseS3Endpoint(raw: string): S3Endpoint {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new S3InputError(
      `"${trimmed}" is not a URL. Give the endpoint as https://<host>, e.g. https://s3.us-south.cloud-object-storage.appdomain.cloud.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new S3InputError(
      "Only https:// endpoints are supported: the gateway can sign a request only when it terminates the TLS connection.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new S3InputError(
      "The endpoint must be a plain https://<host>[:port] URL, without credentials, query or fragment.",
    );
  }
  if (url.pathname !== "/") {
    throw new S3InputError(
      "The endpoint must not carry a path. Use the bucket field to limit access to a bucket.",
    );
  }
  const host = url.hostname;
  if (isIpLiteral(host)) {
    throw new S3InputError(
      `"${host}" looks like an IP address. The endpoint must be a DNS hostname: the gateway routes upstream by TLS SNI, which clients don't send for IPs.`,
    );
  }
  const port = url.port ? Number(url.port) : undefined;
  return {
    host,
    ...(port ? { port } : {}),
    origin: `https://${host}${port ? `:${port}` : ""}`,
  };
}

export function assertBucketName(bucket: string): void {
  if (!BUCKET_NAME.test(bucket)) {
    throw new S3InputError(
      "A bucket name may contain only letters, digits, dots and hyphens.",
    );
  }
}

export function assertKeyText(label: string, value: string): void {
  if (!KEY_TEXT.test(value)) {
    throw new S3InputError(
      `${label} must be printable text without spaces or line breaks.`,
    );
  }
}
