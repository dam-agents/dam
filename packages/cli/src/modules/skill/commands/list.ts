import { Command } from "commander";
import type { LocalSkill, SkillsState } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
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
      const host = await resolveActiveHost(deps, opts.server);

      const agent = await resolveAgentOrExit(
        deps.createAgentService(host),
        ref,
        host,
      );

      const svc = deps.createSkillsService(host);
      const [stateRes, sourcesRes] = await Promise.all([
        svc.state(agent.id),
        svc.listSources(agent.id),
      ]);
      exitOnServiceError(stateRes, host);
      exitOnServiceError(sourcesRes, host);
      const state = stateRes.value;

      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(state)}\n`, EXIT_SUCCESS);
      }
      if (state.installed.length === 0 && state.standalone.length === 0) {
        process.stderr.write(
          `Agent ${ref} has no skills. Install one with \`dam skill install ${ref} --source <id|url> --name <skill>\`, or author one on the pod (Files panel / \`dam file put\`) to see it as standalone.\n`,
        );
        process.exit(EXIT_SUCCESS);
      }

      let out = "";
      if (state.installed.length > 0) {
        out += renderInstalled(state.installed, sourcesRes.value);
      }
      if (state.standalone.length > 0) {
        if (out.length > 0) out += "\n";
        out += renderStandalone(state.standalone, state.instancePublishes);
      }
      return writeStdoutAndExit(out, EXIT_SUCCESS);
    });
}

function renderInstalled(
  installed: SkillsState["installed"],
  sources: readonly { gitUrl: string; name: string }[],
): string {
  const nameByUrl = new Map(sources.map((s) => [s.gitUrl, s.name]));
  const unresolved = new Set<string>();
  const rows = [...installed]
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.name.localeCompare(b.name),
    )
    .map((r) => {
      const name = nameByUrl.get(r.source);
      if (name === undefined) unresolved.add(r.source);
      return [name ?? r.source, r.name, r.version.slice(0, 7)];
    });
  if (unresolved.size > 0) {
    process.stderr.write(
      `note: ${unresolved.size} source(s) no longer registered, shown by URL: ${[...unresolved].join(", ")}\n`,
    );
  }
  return `Installed skills:\n${renderTable([INSTALLED_HEADER, ...rows])}`;
}

function renderStandalone(
  standalone: SkillsState["standalone"],
  publishes: SkillsState["instancePublishes"],
): string {
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
  return `Standalone skills:\n${renderTable([STANDALONE_HEADER, ...rows])}`;
}
