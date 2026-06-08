import { spawn } from "node:child_process";
import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import type { EgressService } from "../../egress/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
  printServiceError,
} from "../../agent/commands/errors.js";
import {
  resolveActiveHost,
  resolveHostFromConfig,
} from "../../shared/preflight.js";
import { createAgentTrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { connectRawBridge } from "../infrastructure/raw-bridge.js";
import { ensureKeyPair, sshPaths } from "../infrastructure/ssh-keys.js";
import {
  buildSshArgs,
  clearManagedHosts,
  editorLaunchArgs,
  ensureManagedSshHost,
  pruneManagedHosts,
} from "../infrastructure/launch.js";
import {
  ensureEditorEgress,
  VSCODE_REMOTE_HOSTS,
} from "../infrastructure/editor-egress.js";

export interface SshDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
  createEgressService: (host: string) => EgressService;
}

const MODES = ["ssh", "code", "zed"] as const;
type LaunchMode = (typeof MODES)[number];
const MODES_PATTERN = MODES.join("|");
const FORCED_EXEC_RE = new RegExp(`^(.+):(${MODES_PATTERN})$`);
const MODE_BINS: Record<LaunchMode, readonly string[]> = {
  ssh: ["ssh"],
  code: ["code", "code-insiders"],
  zed: ["zed"],
};

export function inferMode(base: string): LaunchMode | undefined {
  return MODES.find((m) => MODE_BINS[m].includes(base));
}

export function buildSshCommand(deps: SshDeps): Command {
  const ssh = new Command("ssh").description(
    "Open or wire up SSH access to an agent",
  );

  ssh
    .command("connect")
    .description(
      "Open an SSH session to an agent, or launch an editor/IDE against it",
    )
    .argument("<agent>", "agent name or ID")
    .option(
      "-x, --exec <bin[:mode]>",
      `client to launch: executable name or path, optionally suffixed with ":${MODES_PATTERN}" to force how it's invoked; the mode is otherwise inferred from the name`,
    )
    .option("--server <url>", "override the configured server URL")
    .action(
      async (agentRef: string, opts: { exec?: string; server?: string }) => {
        let mode: LaunchMode = "ssh";
        let exec = "ssh";
        if (opts.exec) {
          const forced = opts.exec.match(FORCED_EXEC_RE);
          if (forced) {
            exec = forced[1]!;
            mode = forced[2] as LaunchMode;
          } else {
            const base = opts.exec.split(/[/\\]/).pop()!.toLowerCase();
            const inferred = inferMode(base);
            if (!inferred)
              die(
                `could not infer mode from --exec "${opts.exec}"; append ":${MODES_PATTERN}" to force one`,
              );
            mode = inferred;
            exec = opts.exec;
          }
        }

        const host = await resolveSshHost(deps, opts.server);
        const paths = sshPaths();
        const [agent] = await Promise.all([
          resolveAgent(deps, host, agentRef),
          orExit(ensureKeyPair(paths), (e) => e.message),
        ]);

        const label = `\`${exec}\``;
        if (mode === "ssh")
          return handoff(
            exec,
            buildSshArgs({ agentRef, serverFlag: opts.server, paths }),
            label,
          );

        if (mode === "code")
          await ensureEditorEgress({
            egress: deps.createEgressService(host),
            agentId: agent.id,
            hosts: VSCODE_REMOTE_HOSTS,
            note: (m) => process.stderr.write(`dam ssh: ${m}\n`),
          });

        const alias = await ensureManagedSshHost({
          agentRef,
          serverFlag: opts.server,
          paths,
        });
        return handoff(exec, editorLaunchArgs(mode, alias), label);
      },
    );

  ssh
    .command("configure")
    .description(
      "Write or remove the dam-managed SSH host config without launching a client. Configure one agent, --all (reconciles: adds current agents, prunes deleted ones), or --clear (remove all)",
    )
    .argument("[agent]", "agent name or ID (omit when using --all/--clear)")
    .option(
      "-a, --all",
      "configure every agent on the active host, pruning hosts whose agent no longer exists",
    )
    .option("--clear", "remove all dam-managed SSH hosts and exit")
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        agentRef: string | undefined,
        opts: { all?: boolean; clear?: boolean; server?: string },
      ) => {
        const modes = [
          agentRef ? "an agent" : null,
          opts.all ? "--all" : null,
          opts.clear ? "--clear" : null,
        ].filter((m): m is string => m !== null);
        if (modes.length !== 1)
          die(
            modes.length === 0
              ? "specify an agent name/ID, --all, or --clear"
              : `pass exactly one of: an agent, --all, or --clear (got ${modes.join(", ")})`,
          );

        if (opts.clear) {
          const cleared = await clearManagedHosts();
          process.stdout.write(
            cleared === 0
              ? "No dam-managed SSH hosts to clear.\n"
              : `Cleared ${cleared} dam-managed SSH host${cleared === 1 ? "" : "s"}.\n`,
          );
          process.exit(0);
        }

        const host = await resolveSshHost(deps, opts.server);
        const paths = sshPaths();
        await orExit(ensureKeyPair(paths), (e) => e.message);

        if (opts.all) {
          const listed = await deps.createAgentService(host).list();
          if (!listed.ok) {
            printServiceError(listed.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          const rows: { name: string; alias: string }[] = [];
          for (const a of listed.value)
            rows.push({
              name: a.name,
              alias: await ensureManagedSshHost({
                agentRef: a.name,
                serverFlag: opts.server,
                paths,
              }),
            });
          const pruned = await pruneManagedHosts({
            keep: new Set(rows.map((r) => r.alias)),
          });
          const out = [
            rows.length === 0
              ? "No agents to configure."
              : `Configured ${rows.length} SSH host${rows.length === 1 ? "" : "s"}:`,
            ...rows.map((r) => `  ${r.alias}  (${r.name})`),
          ];
          if (pruned.length)
            out.push(
              `Pruned ${pruned.length} stale host${pruned.length === 1 ? "" : "s"}: ${pruned.join(", ")}`,
            );
          process.stdout.write(out.join("\n") + "\n");
          process.exit(0);
        }

        const agent = await resolveAgent(deps, host, agentRef!);
        const alias = await ensureManagedSshHost({
          agentRef: agentRef!,
          serverFlag: opts.server,
          paths,
        });
        process.stdout.write(
          `Configured SSH host "${alias}" for agent "${agent.name}". Connect with:\n` +
            `  ssh ${alias}\n` +
            `  code ${editorLaunchArgs("code", alias).join(" ")}\n` +
            `  zed ${editorLaunchArgs("zed", alias).join(" ")}\n`,
        );
        process.exit(0);
      },
    );

  const proxy = new Command("_proxy")
    .description(
      "Internal: act as an ssh ProxyCommand — tunnel stdin/stdout to the agent",
    )
    .argument("<agent>", "agent name or ID")
    .option("--server <url>", "override the configured server URL")
    .action(async (agentRef: string, opts: { server?: string }) => {
      const host = await resolveHostFromConfig(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: { runtimeFailure: EXIT_RUNTIME_FAILURE },
      });
      const paths = sshPaths();
      const [agent, publicKey, tok] = await Promise.all([
        resolveAgent(deps, host, agentRef),
        orExit(ensureKeyPair(paths), (e) => e.message),
        deps.tokenProvider.getValidAccessToken(host),
      ]);
      if (!tok.ok)
        die(
          `not authenticated (${tok.error.kind}); run \`dam auth login\` first`,
        );
      await orExit(
        createAgentTrpcClient({
          host,
          agentId: agent.id,
          tokenProvider: deps.tokenProvider,
        }).ssh.authorizeKey.mutate({ publicKey }),
        (e) => `could not register SSH key with agent: ${e.message}`,
      );
      process.exit(
        await connectRawBridge({
          host,
          token: tok.value,
          agentId: agent.id,
          stdin: process.stdin,
          stdout: process.stdout,
        }),
      );
    });
  ssh.addCommand(proxy, { hidden: true });

  return ssh;
}

function resolveSshHost(deps: SshDeps, serverFlag?: string) {
  return resolveActiveHost(deps, {
    flag: serverFlag ? { server: serverFlag } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
}

async function resolveAgent(
  deps: SshDeps,
  host: string,
  agentRef: string,
): Promise<{ id: string; name: string }> {
  const resolver = createAgentResolver({
    agentService: deps.createAgentService(host),
  });
  const resolved = await resolver.resolve(agentRef);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  return resolved.value;
}

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(EXIT_RUNTIME_FAILURE);
}

async function orExit<T>(p: Promise<T>, msg: (e: Error) => string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    die(msg(e as Error));
  }
}

function handoff(bin: string, args: string[], label: string): Promise<never> {
  return new Promise<never>(() => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) => {
      process.stderr.write(
        e.code === "ENOENT"
          ? `error: ${label} not found on PATH\n`
          : `error: failed to launch ${bin}: ${e.message}\n`,
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    });
    child.on("exit", (code, signal) =>
      process.exit(code ?? (signal ? 1 : EXIT_RUNTIME_FAILURE)),
    );
  });
}
