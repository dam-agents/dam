import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  DelegationFrames,
  StoreDelegationFramesInput,
} from "agent-runtime-api";

const FILE_BYTES_CAP = 4 * 1024 * 1024;
const DIR_BYTES_CAP = 64 * 1024 * 1024;

export interface DelegationFramesStore {
  store(input: StoreDelegationFramesInput): { truncated: boolean };
  read(invocationId: string): DelegationFrames | null;
}

function newestWithinCap(frames: readonly string[]): string[] {
  let size = 0;
  let first = frames.length;
  while (first > 0) {
    const next = size + Buffer.byteLength(frames[first - 1] ?? "") + 1;
    if (next > FILE_BYTES_CAP) break;
    size = next;
    first--;
  }
  return frames.slice(first);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: keeps the conversations of the Invocation targets
 * this Agent drove as root, one `session/update` frame per line in
 * `.platform/delegations/<id>.jsonl`, so a child's conversation lives where
 * its root's own sessions do and goes with the same volume. Each file keeps
 * the newest frames that fit its byte cap, and the directory is byte-capped
 * evicting the oldest files, never the one being written.
 */
export function createDelegationFramesStore(
  agentHome: string,
): DelegationFramesStore {
  const dir = join(agentHome, ".platform", "delegations");
  const fileOf = (invocationId: string) => `${invocationId}.jsonl`;

  function evictBeyondCap(keep: string): void {
    const names = readdirSync(dir);
    for (const name of names)
      if (name.endsWith(".tmp")) unlinkSync(join(dir, name));
    const files = names
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const stat = statSync(join(dir, name));
        return { name, size: stat.size, mtimeMs: stat.mtimeMs };
      });
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const oldestFirst = files
      .filter((f) => f.name !== keep)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of oldestFirst) {
      if (total <= DIR_BYTES_CAP) break;
      unlinkSync(join(dir, file.name));
      total -= file.size;
    }
  }

  return {
    store(input) {
      mkdirSync(dir, { recursive: true });
      const kept = newestWithinCap(input.frames);
      const path = join(dir, fileOf(input.invocationId));
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, kept.map((f) => `${f}\n`).join(""));
      renameSync(tmp, path);
      evictBeyondCap(fileOf(input.invocationId));
      return { truncated: kept.length < input.frames.length };
    },

    read(invocationId) {
      try {
        const text = readFileSync(join(dir, fileOf(invocationId)), "utf8");
        return { frames: text.split("\n").filter((line) => line !== "") };
      } catch {
        return null;
      }
    },
  };
}
