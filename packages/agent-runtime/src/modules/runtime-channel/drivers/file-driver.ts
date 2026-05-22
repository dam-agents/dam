import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Contribution } from "api-server-api";
import type { Driver, DriverContext } from "./types.js";

type FileContribution = Extract<Contribution, { kind: "file" }>;

/** Built-in `file` driver. Materializes a contribution to disk inside
 *  the agent's HOME, refusing any path that escapes that prefix.
 *
 *  Merge modes from ADR-048:
 *    - `overwrite` — replaces the file verbatim
 *    - `section-marker` — rewrites the marker-delimited block between
 *      `# >>> <marker>` and `# <<< <marker>`, leaving anything else
 *      untouched. Creates the file if missing.
 *    - `yaml-fill-if-missing` — legacy pod-files compatibility mode.
 *      Phase 1 leaves this unimplemented (logs and skips). The existing
 *      pod-files SSE path still owns the YAML producers; this driver
 *      takes over when those producers migrate. */
export const fileDriver: Driver<FileContribution> = {
  kind: "file",
  async apply(c, ctx) {
    const absolutePath = resolveSafe(c.path, ctx.agentHome);
    if (!absolutePath) {
      ctx.log(`[runtime-channel:file] refused write outside HOME: ${c.path}`);
      return;
    }
    await mkdir(dirname(absolutePath), { recursive: true });

    switch (c.mergeMode ?? "overwrite") {
      case "overwrite":
        await writeFile(absolutePath, c.content, "utf8");
        return;
      case "section-marker": {
        if (!c.sectionMarker) {
          ctx.log(
            `[runtime-channel:file] section-marker missing marker for ${c.path} — skipping`,
          );
          return;
        }
        const merged = await mergeSection(
          absolutePath,
          c.content,
          c.sectionMarker,
        );
        await writeFile(absolutePath, merged, "utf8");
        return;
      }
      case "yaml-fill-if-missing":
        ctx.log(
          `[runtime-channel:file] yaml-fill-if-missing not yet implemented in runtime-channel driver; ${c.path} skipped`,
        );
        return;
    }
  },
};

function resolveSafe(p: string, agentHome: string): string | null {
  const abs = isAbsolute(p) ? p : join(agentHome, p);
  const r = resolve(abs);
  const home = resolve(agentHome);
  if (r !== home && !r.startsWith(home + "/")) return null;
  return r;
}

async function mergeSection(
  path: string,
  block: string,
  marker: string,
): Promise<string> {
  const begin = `# >>> ${marker}`;
  const end = `# <<< ${marker}`;
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = "";
  }
  const newBlock = `${begin}\n${block.endsWith("\n") ? block : block + "\n"}${end}\n`;
  if (!existing.includes(begin) || !existing.includes(end)) {
    return existing.length === 0
      ? newBlock
      : (existing.endsWith("\n") ? existing : existing + "\n") + newBlock;
  }
  const beforeIdx = existing.indexOf(begin);
  const afterIdx = existing.indexOf(end, beforeIdx) + end.length;
  const after = existing.slice(afterIdx).replace(/^\n/, "");
  return existing.slice(0, beforeIdx) + newBlock + (after ? "\n" + after : "");
}
