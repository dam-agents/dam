import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Names the runtime manifest file of every harness
 * an image ships, beside the agent-runtime's own directory. The default image
 * keeps one manifest per harness under `runtime-manifests/`, named after the
 * harness; an image without one for the Agent's harness keeps a single
 * `runtime-manifest.yaml`. It reads only the directory, so the runtime's entry
 * point can find the manifests before the server bundle and its schemas load.
 */
export function harnessManifestPaths(
  appDir: string,
  defaultHarness: string,
): Record<string, string> {
  const dir = join(appDir, "runtime-manifests");
  if (!existsSync(join(dir, `${defaultHarness}.yaml`))) {
    return { [defaultHarness]: join(appDir, "runtime-manifest.yaml") };
  }
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => [basename(f, ".yaml"), join(dir, f)]),
  );
}
