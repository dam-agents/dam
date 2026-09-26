import { Command } from "commander";
import type { AgentService } from "../../agent/index.js";
import { resolveAgentOrExit } from "../../agent/commands/errors.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_RUNTIME_FAILURE, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm, exitCancelled } from "../../shared/prompt.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { errorMessage } from "../../shared/error-message.js";

export interface ManageDeps {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createTrpc: (host: string) => TrpcClient;
}

interface CommonOpts {
  server?: string;
  json?: boolean;
}

function serverOption(command: Command): Command {
  return command
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default table");
}

async function attempt<T>(at: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    process.stderr.write(`${errorMessage(err)} (${at})\n`);
    return process.exit(EXIT_RUNTIME_FAILURE);
  }
}

export function buildListCommand(deps: ManageDeps): Command {
  return serverOption(
    new Command("list").description("List this account's satellites"),
  ).action(async (opts: CommonOpts) => {
    const at = await resolveActiveHost(deps, opts.server);
    const rows = await attempt(at, () =>
      deps.createTrpc(at).satellites.list.query(),
    );
    if (opts.json)
      return writeStdoutAndExit(`${JSON.stringify(rows)}\n`, EXIT_SUCCESS);
    if (rows.length === 0) {
      process.stderr.write(
        "No satellites. Start one with `dam satellite mcp`.\n",
      );
      return process.exit(EXIT_SUCCESS);
    }
    const table = rows.map((row) => [
      row.name,
      !row.online ? "offline" : row.draining ? "draining" : "online",
      row.host ?? "—",
      String(row.tools.length),
      String(row.activeJobs),
      String(row.grantedAgentIds.length),
    ]);
    return writeStdoutAndExit(
      renderTable([
        ["NAME", "STATE", "HOST", "TOOLS", "ACTIVE", "AGENTS"],
        ...table,
      ]),
      EXIT_SUCCESS,
    );
  });
}

export function buildJobsCommand(deps: ManageDeps): Command {
  return serverOption(
    new Command("jobs")
      .description("List a satellite's jobs")
      .argument("<satellite>", "satellite name"),
  ).action(async (name: string, opts: CommonOpts) => {
    const at = await resolveActiveHost(deps, opts.server);
    const rows = await attempt(at, () =>
      deps.createTrpc(at).satellites.jobs.query(name),
    );
    if (opts.json)
      return writeStdoutAndExit(`${JSON.stringify(rows)}\n`, EXIT_SUCCESS);
    if (rows.length === 0) {
      process.stderr.write(`${name} has run no jobs.\n`);
      return process.exit(EXIT_SUCCESS);
    }
    return writeStdoutAndExit(
      renderTable([
        ["JOB", "STATUS", "EXIT", "AGENT", "CALL"],
        ...rows.map((row) => [
          row.ref,
          row.status,
          row.exitCode === null ? "—" : String(row.exitCode),
          row.agentId,
          `${row.tool} ${JSON.stringify(row.args)}`,
        ]),
      ]),
      EXIT_SUCCESS,
    );
  });
}

export function buildGrantCommand(deps: ManageDeps, revoke: boolean): Command {
  const verb = revoke ? "revoke" : "grant";
  return serverOption(
    new Command(verb)
      .description(
        revoke
          ? "Stop an agent from reaching a satellite"
          : "Let an agent reach a satellite",
      )
      .argument("<satellite>", "satellite name")
      .argument("<agent>", "Agent Ref — name or 'agent-…' ID"),
  ).action(async (name: string, ref: string, opts: CommonOpts) => {
    const at = await resolveActiveHost(deps, opts.server);
    const { id: agentId } = await resolveAgentOrExit(
      deps.createAgentService(at),
      ref,
      at,
    );
    const trpc = deps.createTrpc(at);
    await attempt(at, () =>
      revoke
        ? trpc.satellites.revoke.mutate({ satellite: name, agentId })
        : trpc.satellites.grant.mutate({ satellite: name, agentId }),
    );
    process.stderr.write(
      revoke
        ? `${ref} can no longer reach ${name}.\n`
        : `${ref} can now reach ${name}. Its harness picks the tools up when it next starts.\n`,
    );
    return process.exit(EXIT_SUCCESS);
  });
}

export function buildCancelCommand(deps: ManageDeps): Command {
  return serverOption(
    new Command("cancel")
      .description("Ask a satellite to stop a job")
      .argument("<satellite>", "satellite name")
      .argument("<job>", "job number"),
  ).action(async (name: string, job: string, opts: CommonOpts) => {
    const at = await resolveActiveHost(deps, opts.server);
    await attempt(at, () =>
      deps
        .createTrpc(at)
        .satellites.cancelJob.mutate({ satellite: name, job: Number(job) }),
    );
    process.stderr.write(
      `Asked ${name} to stop #${job}. Cancellation is cooperative — a running command may still finish.\n`,
    );
    return process.exit(EXIT_SUCCESS);
  });
}

export function buildRemoveCommand(deps: ManageDeps): Command {
  return serverOption(
    new Command("rm")
      .description("Remove a satellite and every grant to it")
      .argument("<satellite>", "satellite name")
      .option("--yes", "skip the confirmation prompt"),
  ).action(async (name: string, opts: CommonOpts & { yes?: boolean }) => {
    if (!opts.yes) {
      if (process.stdin.isTTY !== true) {
        process.stderr.write(
          "Refusing to remove without --yes on a non-TTY.\n",
        );
        return process.exit(EXIT_RUNTIME_FAILURE);
      }
      if (
        !(await confirm(
          `Remove satellite ${name} and every grant to it? Commands already running on the machine will not be stopped.`,
        ))
      )
        exitCancelled(opts);
    }
    const at = await resolveActiveHost(deps, opts.server);
    await attempt(at, () => deps.createTrpc(at).satellites.remove.mutate(name));
    process.stderr.write(
      `Removed ${name}. Commands already running on the machine were not stopped.\n`,
    );
    return process.exit(EXIT_SUCCESS);
  });
}
