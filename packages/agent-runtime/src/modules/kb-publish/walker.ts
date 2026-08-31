import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";

import { err, ok, type Result } from "agent-runtime-api";
import type { KbPublishPlan, KbPublishPlanFile } from "agent-runtime-api";
import {
  contentHash,
  shouldConsiderFileName,
  type KbPublishCaps,
  type KbPublishFailure,
} from "agent-runtime-api/kb-snapshot";

import { readTextFile } from "./read-text.js";

export async function planShare(opts: {
  workDir: string;
  roots: readonly string[];
  caps: KbPublishCaps;
}): Promise<Result<KbPublishPlan, KbPublishFailure>> {
  const candidates: { abs: string; rel: string }[] = [];
  for (const root of opts.roots) {
    const rootAbs = join(opts.workDir, root);
    let rootReal: string;
    try {
      const st = await stat(rootAbs);
      if (!st.isDirectory()) return err({ code: "root-missing", root });
      rootReal = await realpath(rootAbs);
    } catch {
      return err({ code: "root-missing", root });
    }
    const containedInRoot = (real: string): boolean =>
      real === rootReal || real.startsWith(`${rootReal}/`);
    const visited = new Set<string>([rootReal]);
    const pending: { abs: string; rel: string; depth: number }[] = [
      { abs: rootAbs, rel: root, depth: 0 },
    ];
    while (pending.length > 0) {
      const dir = pending.shift()!;
      let entries;
      try {
        entries = await readdir(dir.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const childAbs = join(dir.abs, entry.name);
        const childRel = `${dir.rel}/${entry.name}`;
        let childStat;
        try {
          childStat = await stat(childAbs);
        } catch {
          continue;
        }
        if (childStat.isDirectory()) {
          if (dir.depth + 1 > opts.caps.maxWalkDepth) {
            return err({ code: "too-deep" });
          }
          let real: string;
          try {
            real = await realpath(childAbs);
          } catch {
            continue;
          }
          if (!containedInRoot(real)) continue;
          if (visited.has(real)) continue;
          visited.add(real);
          pending.push({ abs: childAbs, rel: childRel, depth: dir.depth + 1 });
        } else if (childStat.isFile() && shouldConsiderFileName(entry.name)) {
          let real: string;
          try {
            real = await realpath(childAbs);
          } catch {
            continue;
          }
          if (!containedInRoot(real)) continue;
          candidates.push({ abs: childAbs, rel: childRel });
          if (candidates.length > opts.caps.maxFiles) {
            return err({ code: "too-many-files" });
          }
        }
      }
      await yieldToLoop();
    }
  }

  const files: KbPublishPlanFile[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const buf = await readTextFile(candidate.abs, opts.caps.perFileMaxBytes);
    if (buf === null) continue;
    totalBytes += buf.byteLength;
    if (totalBytes > opts.caps.totalMaxBytes) {
      return err({ code: "total-too-large" });
    }
    files.push({
      path: candidate.rel,
      sizeBytes: buf.byteLength,
      contentHash: contentHash(buf),
    });
    await yieldToLoop();
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return ok({ files });
}
