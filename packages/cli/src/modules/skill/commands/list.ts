import { Command } from "commander";
import type { SkillRef } from "api-server-api";
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
import type { SkillsService } from "../services/skills-service.js";

const HEADER = ["SOURCE", "NAME", "VERSION"];

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("list")
    .description("List the skills installed on an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam skill list my-agent\n" +
        "  dam skill list my-agent --json\n",
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

      const svc = deps.createSkillsService(host);
      // Independent reads — the installed inventory and the source list (to
      // resolve gitUrls to names) have no dependency, so fetch concurrently.
      const [installedRes, sourcesRes] = await Promise.all([
        svc.installed(resolved.value.id),
        svc.listSources(resolved.value.id),
      ]);
      if (!installedRes.ok) {
        printServiceError(installedRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (!sourcesRes.ok) {
        printServiceError(sourcesRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(installedRes.value)}\n`);
        process.exit(EXIT_SUCCESS);
      }
      if (installedRes.value.length === 0) {
        process.stderr.write(
          `Agent ${ref} has no installed skills. Install one with \`dam skill install ${ref} --source <id|url> --name <skill>\`.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }

      // Join key is the git URL: an installed ref's `source` is the gitUrl.
      // Unresolved gitUrls (source deleted) fall back to the raw URL.
      const nameByUrl = new Map(
        sourcesRes.value.map((s) => [s.gitUrl, s.name]),
      );
      const unresolved = new Set<string>();
      const sorted = [...installedRes.value].sort(bySourceThenName);
      const rows = sorted.map((r: SkillRef) => {
        const name = nameByUrl.get(r.source);
        if (name === undefined) unresolved.add(r.source);
        return [name ?? r.source, r.name, r.version.slice(0, 7)];
      });
      process.stdout.write(renderTable([HEADER, ...rows]));
      if (unresolved.size > 0) {
        process.stderr.write(
          `note: ${unresolved.size} source(s) no longer registered, shown by URL: ${[...unresolved].join(", ")}\n`,
        );
      }
      process.exit(EXIT_SUCCESS);
    });
}

function bySourceThenName(a: SkillRef, b: SkillRef): number {
  const s = a.source.localeCompare(b.source);
  return s !== 0 ? s : a.name.localeCompare(b.name);
}
