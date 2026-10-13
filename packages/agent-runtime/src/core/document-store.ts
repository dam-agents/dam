import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ZodType } from "zod";

export interface DocumentStore<T> {
  read(): T;
  write(next: T): void;
}

export interface DocumentStoreBackend {
  open<T>(
    name: string,
    opts: { schema: ZodType<T>; initial: () => NoInfer<T> },
  ): DocumentStore<T>;
}

export function createFileDocumentStoreBackend(
  agentHome: string,
): DocumentStoreBackend {
  return {
    open(name, opts) {
      return openJsonFile(join(agentHome, ".platform", `${name}.json`), opts);
    },
  };
}

export function openJsonFile<T>(
  path: string,
  { schema, initial }: { schema: ZodType<T>; initial: () => NoInfer<T> },
): DocumentStore<T> {
  let cache: T;
  let loaded = false;

  function loadFromDisk(): T {
    if (!existsSync(path)) return initial();
    try {
      const result = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return result.success ? result.data : initial();
    } catch {
      return initial();
    }
  }

  return {
    read() {
      if (!loaded) {
        cache = loadFromDisk();
        loaded = true;
      }
      return cache;
    },
    write(next) {
      const tmp = `${path}.tmp`;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(tmp, JSON.stringify(next, null, 2));
        renameSync(tmp, path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOSPC") throw err;
        rmSync(tmp, { force: true });
        process.stderr.write(
          `[store] ${path} kept in memory only: no space left on device\n`,
        );
      }
      cache = next;
      loaded = true;
    },
  };
}
