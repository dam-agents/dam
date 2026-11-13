export type DiffLayout = "unified" | "split";

export function fileDiffAnchor(path: string): string {
  return `file-diff-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

export function scrollToFileDiff(path: string): void {
  const el = document.getElementById(fileDiffAnchor(path));
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}
