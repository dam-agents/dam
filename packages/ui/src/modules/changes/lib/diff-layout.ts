import type { FileDiff } from "agent-runtime-api";

export type DiffLayout = "unified" | "split";

export const LARGE_FILE_CHANGED_LINES = 800;

export type FileDiffBody = "shown" | "collapsed" | "binary" | "too-large";

export function fileDiffBody(
  file: FileDiff,
  expandedByUser: boolean | null,
): FileDiffBody {
  if (file.binary) return "binary";
  if (file.patch === null) return "too-large";
  const expanded =
    expandedByUser ??
    file.additions + file.deletions <= LARGE_FILE_CHANGED_LINES;
  return expanded ? "shown" : "collapsed";
}

export function fileDiffAnchor(prefix: string, index: number): string {
  return `${prefix}-file-${index}`;
}
