import { isPreRelease } from "../cli/domain/compat.js";
import { CLI_PACKAGE } from "../cli/infrastructure/npm-latest-probe.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the command that reaches a CLI version the local
 * one is behind. `dam update` installs the npm `latest` dist-tag, which is the
 * newest stable release, so it cannot follow a pre-release recommendation: a
 * server built from an RC line recommends another RC while `latest` still names
 * the previous stable. That advice names the exact version instead.
 */
export function upgradeAdvice(version: string): string {
  return isPreRelease(version)
    ? `run \`npm install -g ${CLI_PACKAGE}@${version}\` — \`dam update\` installs only the latest stable release`
    : "run `dam update`";
}
