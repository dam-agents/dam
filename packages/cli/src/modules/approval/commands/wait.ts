import { Command } from "commander";
import type { ApprovalView } from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_INVALID_INPUT, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import type { ApprovalService } from "../services/approval-service.js";

const POLL_MS = 2_000;
const DEFAULT_TIMEOUT_SECONDS = 300;

function describe(approval: ApprovalView): string {
  const payload = approval.payload;
  return payload.kind === "agent_change" ? payload.title : approval.type;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the other half of a change an assistant asked for.
 * The command that asked was told an approval id and nothing ran; this waits for
 * the owner's verdict and reports what became of the change, which the server
 * wrote on the row — the assistant never re-runs the call itself, so an approved
 * change happens exactly once, whoever is watching.
 */
export function buildWaitCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createApprovalService: (host: string) => ApprovalService;
}): Command {
  return new Command("wait")
    .description("Wait for the owner's verdict on an approval")
    .argument("<id>", "approval id")
    .option(
      "--timeout <seconds>",
      `how long to wait before giving up (default ${String(DEFAULT_TIMEOUT_SECONDS)})`,
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the settled approval as JSON")
    .addHelpText(
      "after",
      "\nUse it after a change an assistant asked for: the command that wanted it\nprints the approval id and exits, and this reports the outcome once your owner\ndecides. Nothing is re-run here — an approved change has already happened.\n",
    )
    .action(
      async (
        id: string,
        opts: { timeout?: string; server?: string; json?: boolean },
      ) => {
        const timeoutSeconds =
          opts.timeout === undefined
            ? DEFAULT_TIMEOUT_SECONDS
            : Number(opts.timeout);
        if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
          process.stderr.write(
            "error: --timeout must be a whole number of seconds\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const host = await resolveActiveHost(deps, opts.server);
        const service = deps.createApprovalService(host);
        const deadline = Date.now() + timeoutSeconds * 1000;

        for (;;) {
          const result = await service.get(id);
          exitOnServiceError(result, host);
          const approval = result.value;
          if (approval === null) {
            process.stderr.write(
              `error: no approval ${id} — see \`dam approval list --status all\`\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          if (approval.status !== "pending") {
            if (opts.json) {
              process.stdout.write(`${JSON.stringify(approval)}\n`);
              process.exit(EXIT_SUCCESS);
            }
            report(approval);
            process.exit(EXIT_SUCCESS);
          }
          if (Date.now() >= deadline) {
            process.stderr.write(
              `error: no verdict on ${id} yet — it stays open until ${approval.expiresAt}\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      },
    );
}

function report(approval: ApprovalView): void {
  const payload = approval.payload;
  if (payload.kind !== "agent_change") {
    process.stdout.write(
      `${approval.status === "expired" ? "Expired" : (approval.verdict ?? approval.status)}: ${describe(approval)}\n`,
    );
    return;
  }
  if (approval.status === "expired") {
    process.stdout.write(
      `Expired — your owner never decided about "${payload.title}". Nothing ran.\n`,
    );
    return;
  }
  if (approval.verdict?.startsWith("allow") !== true) {
    process.stdout.write(
      `Declined — your owner refused "${payload.title}". Nothing ran.\n`,
    );
    return;
  }
  const outcome = payload.outcome;
  if (outcome === undefined) {
    process.stdout.write(`Approved — "${payload.title}" ran.\n`);
    return;
  }
  process.stdout.write(
    outcome.status === "ran"
      ? `Approved — "${payload.title}" ran.\n`
      : `Approved — "${payload.title}" was refused by the server: ${outcome.error ?? "unknown reason"}\n`,
  );
}
