import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CliBundle {
  version: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the `dam` CLI of the commit this image was built
 * from, and the version it reports, so an assistant's machine runs the CLI that
 * matches the server it talks to instead of whichever release npm happens to
 * hold. Absent from an image built without it, which serves 404 rather than a
 * CLI that cannot work.
 */
export function readCliBundle(dir: string): CliBundle | null {
  try {
    const bytes = new Uint8Array(readFileSync(join(dir, "dam.mjs")));
    const { version } = JSON.parse(
      readFileSync(join(dir, "version.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof version !== "string" || version === "") {
      process.stderr.write(
        `cli bundle: ${dir}: version.json names no version\n`,
      );
      return null;
    }
    return { version, bytes };
  } catch (err) {
    process.stderr.write(
      `cli bundle: ${dir}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}
