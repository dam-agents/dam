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

export function scrollTopToShow(
  container: { top: number; scrollTop: number },
  target: { top: number; scrollMarginTop: number },
): number {
  return Math.max(
    0,
    container.scrollTop + target.top - container.top - target.scrollMarginTop,
  );
}

export interface FileDiffData {
  oldFile: { fileName: string };
  newFile: { fileName: string };
  hunks: string[];
}

const diffData = new WeakMap<FileDiff, FileDiffData>();

export function fileDiffData(file: FileDiff): FileDiffData {
  let data = diffData.get(file);
  if (!data) {
    data = {
      oldFile: { fileName: file.oldPath ?? file.path },
      newFile: { fileName: file.path },
      hunks: file.patch === null ? [] : [file.patch],
    };
    diffData.set(file, data);
  }
  return data;
}
