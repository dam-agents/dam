import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tsup `define` substitutes this identifier with a JSON string literal at
// build time. In dev (`tsx`), it stays undefined and the `typeof` guard
// keeps the read safe — we fall through to a best-effort upward walk.
declare const __CLI_VERSION__: string | undefined;

export function readPackageVersion(): string {
  if (typeof __CLI_VERSION__ === "string") return __CLI_VERSION__;
  return readVersionFromDisk();
}

function readVersionFromDisk(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(dir, "package.json"), "utf-8"),
      ) as { name?: string; version?: string };
      if (pkg.name === "@dam-agents/cli" && pkg.version) return pkg.version;
    } catch {
      // not at the package root yet
    }
    dir = resolve(dir, "..");
  }
  throw new Error("could not resolve @dam-agents/cli package.json");
}
