import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");

/**
 * Vitest globalSetup — builds `dist/bin.js` once per test invocation so
 * the integration tests do not race tsup against each other (which used
 * to surface as flaky `unlink: ENOENT` errors and downstream
 * `Cannot find module dist/bin.js` failures across unrelated files).
 *
 * Per-file `beforeAll(tsup)` still works in isolation, but with five
 * integration files in this package the races became reliable failure
 * triggers. Centralising the build removes the contention entirely.
 */
export default async function (): Promise<void> {
  await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
}
