import { Command } from "commander";
import { formatEgressRuleSource } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import type { EgressService } from "../services/egress-service.js";

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}): Command {
  return new Command("list")
    .description("List network access rules for an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n  dam network list my-agent\n  dam network list agent-abc123 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      const resolver = createAgentResolver({
        agentService: deps.createAgentService(host),
      });
      const resolved = await resolver.resolve(ref);
      if (!resolved.ok) {
        printResolveError(resolved.error, host);
        process.exit(exitCodeForResolveError(resolved.error));
      }

      const result = await deps
        .createEgressService(host)
        .listForAgent(resolved.value.id);
      if (!result.ok) {
        printServiceError(result.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_SUCCESS);
      }

      if (result.value.length === 0) {
        process.stderr.write(
          `No network access rules. Add one with \`dam network create ${ref} --host <h>\` or apply a preset with \`dam network apply-preset ${ref} --preset trusted\`.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }

      const sorted = [...result.value].sort((a, b) => {
        const h = a.host.localeCompare(b.host);
        if (h !== 0) return h;
        const m = a.method.localeCompare(b.method);
        if (m !== 0) return m;
        return a.pathPattern.localeCompare(b.pathPattern);
      });
      process.stdout.write(
        renderTable([
          ["ID", "VERDICT", "METHOD", "HOST", "PATH", "SOURCE"],
          ...sorted.map((r) => [
            r.id,
            r.verdict,
            r.method,
            r.host,
            r.pathPattern,
            formatEgressRuleSource(r.source),
          ]),
        ]),
      );
      process.exit(EXIT_SUCCESS);
    });
}
