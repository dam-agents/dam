import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Command } from "commander";

function resolvePackageVersion(): string {
  // `../../../../package.json` from `src/modules/cli/compose.ts`, and
  // `../../package.json` from `dist/bin.js`. Walk up until we find a
  // package.json so the same resolution works in dev (tsx) and after build.
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

export function compose(): Command {
  const program = new Command();
  program
    .name("dam")
    .description("Command-line client for a Platform deployment")
    .version(resolvePackageVersion());
  return program;
}
