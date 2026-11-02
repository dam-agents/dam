import { Command } from "commander";
import { compareVersions, type CompatVerdict } from "../domain/compat.js";
import type { NpmLatestProbe } from "../infrastructure/npm-latest-probe.js";
import type { CompatService } from "../services/compat-service.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";

export interface VersionCommandDeps {
  service: CompatService;
  npm: NpmLatestProbe;
  localCliVersion: string;
}

interface VersionReport {
  cliVersion: string;
  serverVersion: string | null;
  minClientVersion: string | null;
  recommendedClientVersion: string | null;
  latestCliVersion: string | null;
  verdict: CompatVerdict["kind"] | null;
  behindLatest: boolean | null;
  upToDate: boolean | null;
  serverError?: string;
  latestError?: string;
}

export function buildVersionCommand(deps: VersionCommandDeps): Command {
  return new Command("version")
    .description(
      "Print the local CLI version, the server's, and the latest CLI on npm, and say when the CLI is out of date",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the versions and the verdict as JSON")
    .addHelpText("after", "\nExamples:\n  dam version\n  dam version --json\n")
    .action(async (opts: { server?: string; json?: boolean }) => {
      const [compat, latest] = await Promise.all([
        deps.service.check({
          flag: opts.server ? { server: opts.server } : undefined,
        }),
        deps.npm.latest(),
      ]);

      const local = deps.localCliVersion;
      const verdict = compat.ok ? compat.value : undefined;
      const behindLatest = latest.ok
        ? compareVersions(local, latest.value) < 0
        : null;
      const report: VersionReport = {
        cliVersion: local,
        serverVersion: verdict?.serverVersion ?? null,
        minClientVersion: verdict?.serverMinClient ?? null,
        recommendedClientVersion: verdict?.serverRecommendedClient ?? null,
        latestCliVersion: latest.ok ? latest.value : null,
        verdict: verdict?.kind ?? null,
        behindLatest,
        upToDate: upToDate(verdict, behindLatest),
      };
      if (!compat.ok && compat.error.kind !== "missing-config") {
        report.serverError =
          compat.error.kind === "malformed-config"
            ? compat.error.reason
            : compat.error.message;
      }
      if (!latest.ok) report.latestError = latest.error.message;

      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(report)}\n`, EXIT_SUCCESS);
      }

      process.stdout.write(`dam ${local}\n`);
      if (verdict) {
        const notes = [
          verdict.serverMinClient !== undefined &&
            `min CLI ${verdict.serverMinClient}`,
          verdict.serverRecommendedClient !== undefined &&
            `recommended CLI ${verdict.serverRecommendedClient}`,
        ].filter(Boolean);
        const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
        process.stdout.write(`server ${verdict.serverVersion}${suffix}\n`);
      }
      if (latest.ok) process.stdout.write(`npm latest ${latest.value}\n`);

      if (report.serverError !== undefined) {
        process.stderr.write(`server unreachable: ${report.serverError}\n`);
      }
      if (report.latestError !== undefined) {
        process.stderr.write(
          `npm unreachable: ${report.latestError}; cannot tell whether a newer CLI exists\n`,
        );
      }
      if (verdict?.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${local} is below the server's minimum required version ${verdict.serverMinClient}. ping/auth login/shell will fail until you upgrade.\n`,
        );
      } else if (verdict?.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${local} is behind the server's recommended CLI ${verdict.serverRecommendedClient}; run \`dam update\`\n`,
        );
      }
      if (latest.ok && behindLatest) {
        process.stderr.write(
          `warning: CLI ${local} is behind ${latest.value}, the latest on npm; run \`dam update\`\n`,
        );
      }
    });
}

function upToDate(
  verdict: CompatVerdict | undefined,
  behindLatest: boolean | null,
): boolean | null {
  if (verdict !== undefined && verdict.kind !== "ok") return false;
  if (behindLatest !== null) return !behindLatest;
  return verdict?.serverRecommendedClient !== undefined ? true : null;
}
