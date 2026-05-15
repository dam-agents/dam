import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { lstat, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";
import { err, ok, type Result } from "../../../result.js";
import { EXIT_IMPORT_SIGINT } from "../commands/exit-codes.js";

/** Mirror of packages/ui/src/modules/files/api/import-bundle.ts EXCLUDE_FROM_IMPORT. */
export const EXCLUDE_FROM_IMPORT = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
  ".DS_Store",
]);

export interface ResolvedArg {
  /** Path string the user typed — for prompts and error messages. */
  input: string;
  abs: string;
  name: string;
  kind: "file" | "dir";
}

export interface PackedBundle {
  tmpPath: string;
  byteLength: number;
  cleanup(): Promise<void>;
}

export type BundleError = {
  kind: "bundle-failed";
  reason: string;
};

export interface BundleBuilder {
  pack(args: readonly ResolvedArg[]): Promise<Result<PackedBundle, BundleError>>;
}

/** Validate raw user paths once, up-front: stat, classify, collision-check,
 *  top-level exclusion-check. Cheap; runs before instance resolution. */
export async function resolveArgs(
  paths: readonly string[],
): Promise<Result<ResolvedArg[], BundleError>> {
  const out: ResolvedArg[] = [];
  const byName = new Map<string, string>();

  for (const input of paths) {
    const abs = resolvePath(input);
    const name = basename(abs);
    if (EXCLUDE_FROM_IMPORT.has(name)) {
      return err({
        kind: "bundle-failed",
        reason: `'${input}': '${name}' is in the excluded set`,
      });
    }
    const prior = byName.get(name);
    if (prior !== undefined) {
      return err({
        kind: "bundle-failed",
        reason: `duplicate top-level name '${name}' from '${prior}' and '${input}'`,
      });
    }
    let st;
    try {
      st = await lstat(abs);
    } catch (e) {
      return err({ kind: "bundle-failed", reason: `'${input}': ${(e as Error).message}` });
    }
    if (st.isSymbolicLink()) {
      return err({
        kind: "bundle-failed",
        reason: `'${input}': symlinks are not supported as top-level args`,
      });
    }
    if (st.isDirectory()) {
      out.push({ input, abs, name, kind: "dir" });
    } else if (st.isFile()) {
      out.push({ input, abs, name, kind: "file" });
    } else {
      return err({
        kind: "bundle-failed",
        reason: `'${input}': not a regular file or directory`,
      });
    }
    byName.set(name, input);
  }

  return ok(out);
}

export function createBundleBuilder(): BundleBuilder {
  return {
    async pack(args) {
      const tmpDir = await mkdtemp(join(tmpdir(), "dam-import-"));
      const tmpPath = join(tmpDir, "bundle.tar.gz");

      // SIGINT terminates before `finally` runs; sync best-effort rm until cleanup() unhooks it.
      const onSigint = () => {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best effort — process is exiting
        }
        process.exit(EXIT_IMPORT_SIGINT);
      };
      process.once("SIGINT", onSigint);

      const cleanup = async (): Promise<void> => {
        process.removeListener("SIGINT", onSigint);
        await rm(tmpDir, { recursive: true, force: true });
      };

      try {
        await writeBundle(args, tmpPath);
      } catch (e) {
        await cleanup();
        return err({ kind: "bundle-failed", reason: (e as Error).message });
      }

      const byteLength = (await stat(tmpPath)).size;
      return ok({ tmpPath, byteLength, cleanup });
    },
  };
}

async function writeBundle(args: readonly ResolvedArg[], tmpPath: string): Promise<void> {
  const pack = tarPack();
  const sink = createWriteStream(tmpPath);
  const pipeDone = pipeline(pack, createGzip(), sink);

  try {
    for (const a of args) {
      await emit(pack, a.abs, a.name);
    }
    pack.finalize();
    await pipeDone;
  } catch (e) {
    // Destroy the pack so the pipeline rejects cleanly, then swallow the
    // rejection so it isn't unhandled. Re-throw the original cause.
    pack.destroy();
    await pipeDone.catch(() => {});
    throw e;
  }
}

async function emit(pack: ReturnType<typeof tarPack>, abs: string, name: string): Promise<void> {
  let st;
  try {
    st = await lstat(abs);
  } catch {
    // Race: arg vanished between resolveArgs and emit. Skip silently.
    return;
  }
  if (st.isSymbolicLink()) return;

  if (st.isDirectory()) {
    await new Promise<void>((res, rej) => {
      pack.entry({ name: `${name}/`, type: "directory", mode: 0o777 }, (e: Error | null | undefined) =>
        e ? rej(e) : res(),
      );
    });
    const children = await readdir(abs);
    for (const child of children) {
      if (EXCLUDE_FROM_IMPORT.has(child)) continue;
      await emit(pack, join(abs, child), `${name}/${child}`);
    }
    return;
  }

  if (st.isFile()) {
    await new Promise<void>((res, rej) => {
      const entry = pack.entry(
        { name, type: "file", size: st.size, mode: 0o666 },
        (e: Error | null | undefined) => (e ? rej(e) : res()),
      );
      entry.on("error", rej);
      createReadStream(abs).on("error", rej).pipe(entry);
    });
    return;
  }
  // block/char/socket/fifo — ignore.
}
