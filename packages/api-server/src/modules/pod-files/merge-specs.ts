import type { FileSpec, MergeMode } from "./types.js";

/**
 * Merge a flat list of `FileSpec`s by path: producers may emit overlapping
 * paths, and the wire shape collapses them into one entry per path. Modes
 * must agree across producers writing to the same path — a mismatch is a
 * registry-construction bug.
 *
 * Output is sorted by path for deterministic SSE payloads (so reconnect
 * snapshots are byte-stable when state hasn't changed).
 */
export function mergeFileSpecsByPath(specs: FileSpec[]): FileSpec[] {
  const byPath = new Map<
    string,
    { mode: MergeMode; fragments: FileSpec["fragments"] }
  >();
  for (const s of specs) {
    if (s.fragments.length === 0) continue;
    const existing = byPath.get(s.path);
    if (!existing) {
      byPath.set(s.path, { mode: s.mode, fragments: [...s.fragments] });
      continue;
    }
    if (existing.mode !== s.mode) {
      throw new Error(
        `pod-files merge conflict at ${s.path}: mode ${existing.mode} vs ${s.mode}`,
      );
    }
    existing.fragments.push(...s.fragments);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, v]) => ({ path, mode: v.mode, fragments: v.fragments }));
}
