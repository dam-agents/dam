import { Command } from "commander";
import type { KitUpdateStatus } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { renderChanges } from "../domain/kit-update.js";
import { shortKitVersion } from "../domain/kit-ref.js";
import type { KitService } from "../services/kit-service.js";
import { kitErrorDescription } from "./resolve-kit.js";

interface Deps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createKitService: (host: string) => KitService;
}

type Opts = { server?: string; json?: boolean };

function agentCommand(
  name: string,
  description: string,
  json: string,
  examples: readonly string[],
): Command {
  return new Command(name)
    .description(description)
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", json)
    .addHelpText(
      "after",
      `\nExamples:\n${examples.map((e) => `  ${e}\n`).join("")}`,
    );
}

async function resolve(deps: Deps, ref: string, opts: Opts) {
  const host = await resolveActiveHost(deps, opts.server);
  const agent = await resolveAgentOrExit(
    deps.createAgentService(host),
    ref,
    host,
  );
  return { host, agent, svc: deps.createKitService(host) };
}

export function buildChangesCommand(deps: Deps): Command {
  return agentCommand(
    "changes",
    "Show what the next version of an agent's starter kit changes",
    "emit { from, to, compareUrl, versionFrom, versionTo, changelog, commits, totalCommits } as JSON, or null when there is nothing to update",
    ["dam kit changes my-agent", "dam kit changes my-agent --json"],
  ).action(async (ref: string, opts: Opts) => {
    const { host, agent, svc } = await resolve(deps, ref, opts);
    const changes = await svc.changes(agent.id);
    exitOnServiceError(changes, host, kitErrorDescription);
    if (opts.json)
      return writeStdoutAndExit(
        `${JSON.stringify(changes.value)}\n`,
        EXIT_SUCCESS,
      );
    return writeStdoutAndExit(renderChanges(changes.value), EXIT_SUCCESS);
  });
}

export function buildUpdateCommand(deps: Deps): Command {
  return agentCommand(
    "update",
    "Take the newer version of an agent's starter kit: the agent opens a session that brings its setup up to date, and asks you about every change it may not make alone",
    "emit the agent's kit update status { agentId, state, current, latest, pending } as JSON",
    ["dam kit changes my-agent", "dam kit update my-agent"],
  ).action(async (ref: string, opts: Opts) => {
    const { host, agent, svc } = await resolve(deps, ref, opts);
    const status = await svc.startUpdate(agent.id);
    exitOnServiceError(status, host, kitErrorDescription);
    if (opts.json)
      return writeStdoutAndExit(
        `${JSON.stringify(status.value)}\n`,
        EXIT_SUCCESS,
      );
    return writeStdoutAndExit(
      `✓ Started the kit update of "${agent.name}" to ${target(status.value)}.\n` +
        `The agent works through it in a session of its own: find it with \`dam session list ${agent.name}\`, and answer its questions with \`dam run ${agent.name} --session <session-id> -p "<answer>"\`.\n`,
      EXIT_SUCCESS,
    );
  });
}

export function buildSkipCommand(deps: Deps): Command {
  return agentCommand(
    "skip",
    "Skip the newer version of an agent's starter kit; the next version is offered again",
    "emit the agent's kit update status { agentId, state, current, latest, pending } as JSON",
    ["dam kit skip my-agent"],
  ).action(async (ref: string, opts: Opts) => {
    const { host, agent, svc } = await resolve(deps, ref, opts);
    const status = await svc.skipUpdate(agent.id);
    exitOnServiceError(status, host, kitErrorDescription);
    if (opts.json)
      return writeStdoutAndExit(
        `${JSON.stringify(status.value)}\n`,
        EXIT_SUCCESS,
      );
    return writeStdoutAndExit(
      `✓ Skipped version ${target(status.value)} of the kit of "${agent.name}".\n`,
      EXIT_SUCCESS,
    );
  });
}

function target(status: KitUpdateStatus): string {
  return shortKitVersion(
    status.pending?.targetCommit ?? status.latest ?? status.current,
  );
}
