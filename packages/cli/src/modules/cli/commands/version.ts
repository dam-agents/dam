import { Command } from "commander";
import type { CompatService } from "../services/compat-service.js";

export interface VersionCommandDeps {
  service: CompatService;
  localCliVersion: string;
}

/**
 * Un-gated counterpart to `dam ping`. Always exits 0 — informational, not
 * a gate. Local line always prints; server line and warnings are
 * best-effort additions when a server is configured and reachable.
 */
export function buildVersionCommand(deps: VersionCommandDeps): Command {
  return new Command("version")
    .description("Print local CLI version and (best-effort) the server's")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .action(async (opts: { server?: string }) => {
      process.stdout.write(`dam ${deps.localCliVersion}\n`);

      const result = await deps.service.check({
        flag: opts.server ? { server: opts.server } : undefined,
      });

      if (!result.ok) {
        switch (result.error.kind) {
          case "missing-config":
            // Quietly stop — `version` works without a server.
            return;
          case "malformed-config":
            process.stderr.write(
              `server unreachable: ${result.error.reason}\n`,
            );
            return;
          case "probe-error":
            process.stderr.write(
              `server unreachable: ${result.error.message}\n`,
            );
            return;
        }
      }

      const verdict = result.value;
      // Server line first (stdout), then any warning/error (stderr). This
      // preserves the spec'd contract that the server line always prints
      // when reachable, and matches the conventional stdout-then-stderr
      // shape so a trailing warning amplifies the line that just printed.
      const minClient =
        verdict.serverMinClient !== undefined
          ? ` (min CLI ${verdict.serverMinClient})`
          : "";
      process.stdout.write(`server ${verdict.serverVersion}${minClient}\n`);

      if (verdict.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
        );
      } else if (verdict.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}. ping/auth login/shell will fail until you upgrade.\n`,
        );
      }
    });
}
