import { Command } from "commander";
import type { LocalSkill, SkillRef, SkillsState } from "api-server-api";
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

const INSTALLED_HEADER = ["SOURCE", "NAME", "VERSION"];
const STANDALONE_HEADER = ["NAME", "PUBLISHED"];

export function buildListCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("list")
    .description("List the skills on an Agent — installed and standalone")
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
      // Independent reads — the reconciled state and the source list (to
      // resolve gitUrls to names) have no dependency, so fetch concurrently.
      const [stateRes, sourcesRes] = await Promise.all([
        svc.state(resolved.value.id),
        svc.listSources(resolved.value.id),
      ]);
      if (!stateRes.ok) {
        printServiceError(stateRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (!sourcesRes.ok) {
        printServiceError(sourcesRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const state = stateRes.value;

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(state)}\n`);
        process.exit(EXIT_SUCCESS);
      }
      if (state.installed.length === 0 && state.standalone.length === 0) {
        process.stderr.write(
          `Agent ${ref} has no skills. Install one with \`dam skill install ${ref} --source <id|url> --name <skill>\`, or author one on the pod (Files panel / \`dam file put\`) to see it as standalone.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }

      if (state.installed.length > 0) {
        renderInstalled(state.installed, sourcesRes.value);
      }
      if (state.standalone.length > 0) {
        if (state.installed.length > 0) process.stdout.write("\n");
        renderStandalone(state.standalone, state.instancePublishes);
      }
      process.exit(EXIT_SUCCESS);
    });
}

function renderInstalled(
  installed: SkillsState["installed"],
  sources: readonly { gitUrl: string; name: string }[],
): void {
  // Join key is the git URL: an installed ref's `source` is the gitUrl.
  // Unresolved gitUrls (source deleted) fall back to the raw URL.
  const nameByUrl = new Map(sources.map((s) => [s.gitUrl, s.name]));
  const unresolved = new Set<string>();
  const rows = [...installed].sort(bySourceThenName).map((r) => {
    const name = nameByUrl.get(r.source);
    if (name === undefined) unresolved.add(r.source);
    return [name ?? r.source, r.name, r.version.slice(0, 7)];
  });
  process.stdout.write("Installed skills:\n");
  process.stdout.write(renderTable([INSTALLED_HEADER, ...rows]));
  if (unresolved.size > 0) {
    process.stderr.write(
      `note: ${unresolved.size} source(s) no longer registered, shown by URL: ${[...unresolved].join(", ")}\n`,
    );
  }
}

function renderStandalone(
  standalone: SkillsState["standalone"],
  publishes: SkillsState["instancePublishes"],
): void {
  // skillName → most-recent prUrl. publishedAt is ISO 8601, so lexicographic
  // max picks the latest when a skill was published more than once.
  const prByName = new Map<string, string>();
  const latestAt = new Map<string, string>();
  for (const p of publishes) {
    const prev = latestAt.get(p.skillName);
    if (prev === undefined || p.publishedAt > prev) {
      latestAt.set(p.skillName, p.publishedAt);
      prByName.set(p.skillName, p.prUrl);
    }
  }
  const rows = [...standalone]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s: LocalSkill) => [s.name, prByName.get(s.name) ?? "—"]);
  process.stdout.write("Standalone skills:\n");
  process.stdout.write(renderTable([STANDALONE_HEADER, ...rows]));
}

function bySourceThenName(a: SkillRef, b: SkillRef): number {
  const s = a.source.localeCompare(b.source);
  return s !== 0 ? s : a.name.localeCompare(b.name);
}
