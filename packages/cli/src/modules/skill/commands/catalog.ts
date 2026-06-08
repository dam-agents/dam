import { Command } from "commander";
import type { Skill } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_AGENT_NOT_REACHABLE,
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveSourceRef } from "../domain/source-ref.js";
import { type AnnotatedSkill, statusFor } from "../domain/skill-status.js";
import type { SkillsService } from "../services/skills-service.js";

const byName = (a: Skill, b: Skill): number => a.name.localeCompare(b.name);

/** renderTable's inter-column gap. */
const COLUMN_GAP = 3;
/** Floor for the description column on narrow terminals. */
const MIN_DESCRIPTION = 20;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;

/**
 * Render a table whose LAST column is free-form text (a skill description).
 * renderTable doesn't wrap, so a long description would soft-wrap at the
 * terminal edge and bleed across rows; collapse it to one line and truncate
 * with `…` to whatever width the leading columns leave. `--json` keeps the
 * full text.
 */
function renderFittedTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const leadCount = header.length - 1;
  let leadWidth = 0;
  for (let col = 0; col < leadCount; col++) {
    const w = Math.max(header[col]!.length, ...rows.map((r) => r[col]!.length));
    leadWidth += w + COLUMN_GAP;
  }
  const columns = process.stdout.columns ?? 100;
  const budget = Math.max(MIN_DESCRIPTION, columns - leadWidth);
  const clamped = rows.map((r) => [
    ...r.slice(0, -1),
    truncate(collapse(r[r.length - 1]!), budget),
  ]);
  return renderTable([[...header], ...clamped]);
}

export function buildCatalogCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createSkillsService: (host: string) => SkillsService;
}): Command {
  return new Command("catalog")
    .description(
      "Scan a skill source's available skills; with --agent, annotate each skill's install status",
    )
    .argument("<source>", "source id or git URL (from `dam skill source list`)")
    .option(
      "--agent <ref>",
      "Agent Ref — annotate each skill not-installed / installed / update-available, and scan private sources through the Agent's pod",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam skill catalog skl-src-abc123\n" +
        "  dam skill catalog skl-src-abc123 --agent my-agent\n" +
        "  dam skill catalog https://github.com/acme/skills --agent my-agent --json\n",
    )
    .action(
      async (
        ref: string,
        opts: { agent?: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        let agentId: string | undefined;
        if (opts.agent !== undefined) {
          const resolver = createAgentResolver({
            agentService: deps.createAgentService(host),
          });
          const resolved = await resolver.resolve(opts.agent);
          if (!resolved.ok) {
            printResolveError(resolved.error, host);
            process.exit(exitCodeForResolveError(resolved.error));
          }
          agentId = resolved.value.id;
        }

        const svc = deps.createSkillsService(host);

        // A registered source is required — resolve <source> against the
        // source list (which also yields the id the scan keys on).
        const sourcesRes = await svc.listSources(agentId);
        if (!sourcesRes.ok) {
          printServiceError(sourcesRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        const source = resolveSourceRef(sourcesRes.value, ref);
        if (!source) {
          process.stderr.write(
            `error: no registered skill source with id or url '${ref}'\n`,
          );
          process.stderr.write(
            "hint: run `dam skill source list` to see registered sources\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        // Independent reads — the scan and the agent's installed inventory have
        // no dependency, so fetch them concurrently when --agent is set.
        const [catalogRes, installedRes] = await Promise.all([
          svc.catalog(source.id, agentId),
          agentId !== undefined
            ? svc.installed(agentId)
            : Promise.resolve(null),
        ]);

        if (!catalogRes.ok) {
          const e = catalogRes.error;
          if (e.kind === "agent-not-reachable") {
            process.stderr.write(`error: ${e.reason}\n`);
            process.exit(EXIT_AGENT_NOT_REACHABLE);
          }
          if (e.kind === "private-source-needs-agent") {
            process.stderr.write(
              `error: source '${ref}' is private or non-GitHub; pass --agent <ref> to scan it through a running agent\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          if (e.kind === "source-needs-connection") {
            process.stderr.write(`error: ${e.message}\n`);
            if (e.cta)
              process.stderr.write(`hint: connect the source — ${e.cta}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          printServiceError(e, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (installedRes !== null && !installedRes.ok) {
          printServiceError(installedRes.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const installed =
          installedRes !== null ? installedRes.value : undefined;

        if (installed === undefined) {
          // No --agent: raw catalog, no status annotation.
          if (opts.json) {
            process.stdout.write(`${JSON.stringify(catalogRes.value)}\n`);
            process.exit(EXIT_SUCCESS);
          }
          const sorted = [...catalogRes.value].sort(byName);
          process.stdout.write(
            renderFittedTable(
              ["NAME", "DESCRIPTION"],
              sorted.map((s) => [s.name, s.description]),
            ),
          );
          process.exit(EXIT_SUCCESS);
        }

        const annotated: AnnotatedSkill[] = catalogRes.value.map((s) => ({
          ...s,
          status: statusFor(s, installed),
        }));
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(annotated)}\n`);
          process.exit(EXIT_SUCCESS);
        }
        const sorted = [...annotated].sort(byName);
        process.stdout.write(
          renderFittedTable(
            ["NAME", "STATUS", "DESCRIPTION"],
            sorted.map((s) => [s.name, s.status, s.description]),
          ),
        );
        process.exit(EXIT_SUCCESS);
      },
    );
}
