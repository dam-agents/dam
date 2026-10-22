import type { FileChangeStatus } from "agent-runtime-api";

export interface WorktreeRecord {
  path: string;
  head: string | null;
  branch: string | null;
}

export function parseWorktreeList(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  for (const block of output.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line !== "");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (!pathLine) continue;
    if (lines.some((line) => line === "bare" || line.startsWith("prunable")))
      continue;
    const head = lines.find((line) => line.startsWith("HEAD "))?.slice(5);
    const ref = lines.find((line) => line.startsWith("branch "))?.slice(7);
    records.push({
      path: pathLine.slice("worktree ".length),
      head: head && !/^0+$/.test(head) ? head : null,
      branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
    });
  }
  return records;
}

export interface StatusEntry {
  path: string;
  untracked: boolean;
}

export function parseStatus(output: string): StatusEntry[] {
  const fields = output.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    const path = field.slice(3);
    if (code[0] === "R" || code[0] === "C") i++;
    if (code === "!!") continue;
    if (path.endsWith("/")) continue;
    entries.push({ path, untracked: code === "??" });
  }
  return entries;
}

export interface NumstatEntry {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

export function parseNumstat(output: string): NumstatEntry[] {
  const fields = output.split("\0");
  const entries: NumstatEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(field);
    if (!match) continue;
    const [, added, deleted, inline] = match;
    let path = inline!;
    let oldPath: string | null = null;
    if (path === "") {
      oldPath = fields[i + 1] ?? "";
      path = fields[i + 2] ?? "";
      i += 2;
    }
    const binary = added === "-" || deleted === "-";
    entries.push({
      path,
      oldPath,
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    });
  }
  return entries;
}

export function parseNameStatus(output: string): Map<string, FileChangeStatus> {
  const fields = output.split("\0");
  const statuses = new Map<string, FileChangeStatus>();
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i]![0];
    if (code === undefined) continue;
    if (code === "R" || code === "C") {
      const path = fields[i + 2];
      if (path !== undefined)
        statuses.set(path, code === "R" ? "renamed" : "added");
      i += 2;
      continue;
    }
    const path = fields[i + 1];
    i++;
    if (path === undefined) continue;
    statuses.set(
      path,
      code === "A" ? "added" : code === "D" ? "deleted" : "modified",
    );
  }
  return statuses;
}

function stripPrefix(raw: string, prefix: string): string | null {
  const path = raw.replace(/\t$/, "");
  if (path === "/dev/null") return null;
  const unquoted =
    path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

function pathOfChunk(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (line.startsWith("rename to ")) return line.slice("rename to ".length);
    if (line.startsWith("@@")) break;
  }
  let minus: string | null = null;
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const path = stripPrefix(line.slice(4), "b/");
      if (path !== null) return path;
    }
    if (line.startsWith("--- ")) minus = stripPrefix(line.slice(4), "a/");
    if (line.startsWith("@@")) break;
  }
  if (minus !== null) return minus;
  const header = lines[0]!.slice("diff --git a/".length);
  const half = (header.length - " b/".length) / 2;
  return Number.isInteger(half) ? header.slice(0, half) : null;
}

export function splitPatch(patch: string): Map<string, string> {
  const chunks = new Map<string, string>();
  const lines = patch.split("\n");
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const chunk = lines.slice(start, end);
    const path = pathOfChunk(chunk);
    if (path !== null) chunks.set(path, chunk.join("\n").trimEnd() + "\n");
  };
  lines.forEach((line, index) => {
    if (!line.startsWith("diff --git ")) return;
    flush(index);
    start = index;
  });
  flush(lines.length);
  return chunks;
}

export function countPatchLines(patch: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function repositoryNameOf(
  remoteUrl: string | null,
  root: string,
): string {
  const match = remoteUrl
    ? /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim())
    : null;
  if (match) return match[1]!;
  return root.split("/").filter(Boolean).pop() ?? root;
}
