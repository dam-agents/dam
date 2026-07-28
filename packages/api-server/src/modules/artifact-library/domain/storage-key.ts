import { randomUUID } from "node:crypto";

/** Object-store keys, namespaced under `library/` so they can never collide
 *  with other consumers' keys in the shared bucket. */

const SAFE_BASENAME = /[^A-Za-z0-9._-]/g;

function sanitizeBasename(fileName: string): string {
  const base = fileName.split("/").pop() ?? "file";
  const cleaned = base.replace(SAFE_BASENAME, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

/** Staging key for a direct upload — minted before the artifact row exists.
 *  Owner-namespaced so an `uploadRef` can be checked against the caller: a ref
 *  outside the caller's own staging prefix reads as unknown. */
export function stagingKey(owner: string, fileName: string): string {
  return `library/${owner}/staging/${randomUUID()}/${sanitizeBasename(fileName)}`;
}

export function isOwnStagingKey(owner: string, ref: string): boolean {
  return ref.startsWith(`library/${owner}/staging/`);
}

/** Final key for a stored artifact version. */
export function versionKey(
  owner: string,
  artifactId: string,
  version: number,
  fileName: string,
): string {
  return `library/${owner}/${artifactId}/v${version}/${sanitizeBasename(fileName)}`;
}
