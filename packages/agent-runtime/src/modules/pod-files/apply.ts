import { dirname } from "node:path";
import {
  mkdirSync,
  chmodSync,
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import type { FileSpec } from "api-server-api";
import { mergeYAMLFillIfMissing } from "./merge.js";

/**
 * Apply one FileSpec on disk. Refuses any path that doesn't resolve under
 * `agentHome` — defense-in-depth against a buggy or compromised api-server
 * payload writing arbitrary paths in the runtime's filesystem (`/etc/...`,
 * `..` traversals, sibling-prefix tricks like `/home/agentX`). Behaviour
 * mirrors the prior Go sidecar 1:1.
 *
 * Writes are atomic (tmp + rename). Permissions: 0o777 for the parent dir
 * and 0o666 for the file, so a non-root agent process sharing the volume
 * can edit in place — fill-if-missing preserves any value it adds back to.
 */
export function applyFile(file: FileSpec, agentHome: string): void {
  if (file.fragments.length === 0) return;

  const home = stripTrailingSep(resolve(agentHome));
  const target = resolve(file.path);
  if (home === "" || !target.startsWith(home + "/")) {
    throw new Error(
      `refusing to write ${JSON.stringify(file.path)}: path must be under agent home ${JSON.stringify(agentHome)}`,
    );
  }

  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";

  let merged: string;
  let changed: boolean;
  if (file.mode === "yaml-fill-if-missing") {
    ({ merged, changed } = mergeYAMLFillIfMissing(existing, file.fragments));
  } else {
    throw new Error(`unknown merge mode ${JSON.stringify(file.mode)}`);
  }
  if (!changed) return;

  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  // mkdirSync honours umask and may strip group/other write. Force 0o777
  // so the agent container can create sibling files (gh CLI writes
  // state.yml, hosts.yml.lock, etc.).
  chmodSync(dir, 0o777);

  const tmp = target + ".tmp";
  // 0o666 so the agent (non-root) can edit in place — fill-if-missing
  // preserves their changes on the next sync.
  writeFileSync(tmp, merged, { mode: 0o666 });
  try {
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function stripTrailingSep(p: string): string {
  return p.endsWith("/") && p.length > 1 ? p.replace(/\/+$/, "") : p;
}
