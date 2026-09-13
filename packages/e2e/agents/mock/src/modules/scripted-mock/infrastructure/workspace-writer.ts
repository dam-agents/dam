import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { WorkspaceWriter } from "../services/ports.js";

export function createWorkspaceWriter(baseDir: string): WorkspaceWriter {
  const root = resolve(baseDir);
  const inside = (relPath: string): string => {
    const abs = resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`refusing to reach outside workspace: ${relPath}`);
    }
    return abs;
  };
  return {
    async writeFile(relPath, content) {
      const abs = inside(relPath);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    },
    readFile: (relPath) =>
      readFile(inside(relPath), "utf8").catch(() => undefined),
  };
}
