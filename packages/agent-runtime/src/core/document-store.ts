import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ZodType } from "zod";

export interface DocumentStore<T> {
  read(): T;
  write(next: T): void;
}

/** Opens named document stores. The backend owns how a name maps to physical
 * storage — a `.platform/<name>.json` file here, a table elsewhere. */
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

/** A missing, unreadable, or schema-rejected file yields `initial`, never throws. */
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
      mkdirSync(dirname(path), { recursive: true });
      // Write-then-rename so a crash mid-write can't leave a torn file.
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, path);
      cache = next;
      loaded = true;
    },
  };
}
