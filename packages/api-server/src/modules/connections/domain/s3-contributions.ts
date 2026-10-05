import type { Contribution } from "api-server-api";
import { isIpLiteral } from "./kubernetes-contributions.js";

export const S3_SERVICE = "s3";

export const DEFAULT_S3_SIGNING_REGION = "us-east-1";

export const ACCESS_KEY_ID_SECRET_FIELD = "access_key_id";

export const SECRET_ACCESS_KEY_SECRET_FIELD = "secret_access_key";

export interface S3Endpoint {
  host: string;
  port?: number;
}

const S3_ENDPOINT_EXAMPLE =
  "https://s3.us-south.cloud-object-storage.appdomain.cloud";

export function parseS3Endpoint(raw: string): S3Endpoint {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `"${trimmed}" is not a URL. The endpoint must be an https:// URL such as ${S3_ENDPOINT_EXAMPLE}.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      "The endpoint must start with https://. The gateway forwards plain " +
        "HTTP without terminating it, so it cannot sign requests there.",
    );
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `The endpoint is the host only, with no path, query or credentials — e.g. ${S3_ENDPOINT_EXAMPLE}.`,
    );
  }
  const raw6 = url.hostname;
  const host =
    raw6.startsWith("[") && raw6.endsWith("]") ? raw6.slice(1, -1) : raw6;
  if (isIpLiteral(host)) {
    throw new Error(
      `"${host}" looks like an IP address. The endpoint must be a DNS ` +
        "hostname — the gateway routes upstream by TLS SNI, which clients " +
        "don't send for IPs.",
    );
  }
  const port = url.port ? Number(url.port) : undefined;
  return port && port !== 443 ? { host, port } : { host };
}

export function s3EndpointOrigin(endpoint: S3Endpoint): string {
  return `https://${endpoint.host}${endpoint.port ? `:${endpoint.port}` : ""}`;
}

const BUCKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/;

export function validBucketName(raw: string): string {
  const bucket = raw.trim();
  if (!BUCKET_NAME.test(bucket)) {
    throw new Error(
      `"${bucket}" is not a bucket name. Use the bare name of one bucket: letters, digits, dots, hyphens and underscores, no slashes.`,
    );
  }
  return bucket;
}

export interface S3Target extends S3Endpoint {
  bucket?: string;
  region: string;
  service: string;
}

export function bucketPathPatterns(bucket: string): string[] {
  return [`/${bucket}`, `/${bucket}?*`, `/${bucket}/*`];
}

export function buildS3Contributions(target: S3Target): Contribution[] {
  const base: Extract<Contribution, { kind: "egress-sign" }> = {
    kind: "egress-sign",
    host: target.host,
    ...(target.port ? { port: target.port } : {}),
    region: target.region,
    service: target.service,
  };
  if (!target.bucket) return [base];
  return bucketPathPatterns(target.bucket).map((pathPattern) => ({
    ...base,
    pathPattern,
  }));
}

export function awsCredentialsFile(
  accessKeyId: string,
  secretAccessKey: string,
): string {
  return [
    "[default]",
    `aws_access_key_id = ${accessKeyId}`,
    `aws_secret_access_key = ${secretAccessKey}`,
    "",
  ].join("\n");
}
