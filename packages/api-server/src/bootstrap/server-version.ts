import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

const packageJsonSchema = z.object({ version: z.string().min(1) });

/**
 * Reads the api-server's semver from its `package.json` once at startup.
 *
 * Caller passes its own `import.meta.url` so the resolver doesn't need
 * to know the helper's placement on disk — `../package.json` from the
 * caller lands at the package root in both `dist/index.js` (prod) and
 * `src/index.ts` (tsx dev) since both sit one directory below it.
 *
 * Throws — and crashes the pod — on missing/malformed input. Fail-fast
 * at boot beats serving the wrong `/api/version` response.
 *
 * Future: replace with a build-time literal once the api-server adopts
 * a bundler (the CLI's tsup `define` pattern is the model).
 */
export function getServerVersion(callerUrl: string): string {
  const here = dirname(fileURLToPath(callerUrl));
  const path = resolve(here, "../package.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    throw new Error(
      `getServerVersion: cannot read ${path}: ${
        e instanceof Error ? e.message : e
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `getServerVersion: ${path} is not valid JSON: ${
        e instanceof Error ? e.message : e
      }`,
    );
  }
  return packageJsonSchema.parse(parsed).version;
}
