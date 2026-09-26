import { resolve } from "node:path";

export const RESERVED = new Set([".triggers", ".initialized"]);

export function safePath(workingDir: string, rel: string): string | null {
  const resolved = resolve(workingDir, rel);
  if (!resolved.startsWith(resolve(workingDir))) return null;
  return resolved;
}

export function touchesReserved(rel: string): boolean {
  if (!rel) return false;
  return rel.split("/").some((seg) => RESERVED.has(seg));
}
