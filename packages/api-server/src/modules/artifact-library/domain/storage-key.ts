import { randomUUID } from "node:crypto";

const SAFE_BASENAME = /[^A-Za-z0-9._-]/g;

function sanitizeBasename(fileName: string): string {
  const base = fileName.split("/").pop() ?? "file";
  const cleaned = base.replace(SAFE_BASENAME, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

export function stagingKey(owner: string, fileName: string): string {
  return `library/${owner}/staging/${randomUUID()}/${sanitizeBasename(fileName)}`;
}

export function isOwnStagingKey(owner: string, ref: string): boolean {
  return ref.startsWith(`library/${owner}/staging/`);
}

export function versionKey(
  owner: string,
  artifactId: string,
  version: number,
  fileName: string,
  salt?: string,
): string {
  return `library/${owner}/${artifactId}/v${version}${salt ? `-${salt}` : ""}/${sanitizeBasename(fileName)}`;
}
