import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { WorkspaceWriter } from "../services/ports.js";

export function createWorkspaceWriter(baseDir: string): WorkspaceWriter {
  const root = resolve(baseDir);
  return {
    async writeFile(relPath, content) {
      const abs = resolve(root, relPath);
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`refusing to write outside workspace: ${relPath}`);
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    },
  };
}
