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
  editorLaunchArgs,
  ensureManagedSshHost,
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
          resolveAgent(deps, host, agentRef), // early "not found" before handoff
          orExit(ensureKeyPair(paths), (e) => e.message),
        ]);

        const label = `\`${exec}\``;
        if (mode === "ssh")
          return handoff(
            exec,
            buildSshArgs({ agentRef, serverFlag: opts.server, paths }),
            label,
          );

        // VS Code Remote-SSH downloads its in-pod server from a couple of
        // Microsoft hosts; pre-allow them so the agent's network gate doesn't
        // pop an approval prompt in the web UI mid-connect. Best-effort.
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
      "Write the dam-managed SSH host config for an agent (or --all), without launching a client",
    )
    .argument("[agent]", "agent name or ID (omit when using --all)")
    .option("-a, --all", "configure every agent on the active host")
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        agentRef: string | undefined,
        opts: { all?: boolean; server?: string },
      ) => {
        if (!!agentRef === !!opts.all)
          die(
            agentRef
              ? "pass either an agent or --all, not both"
              : "specify an agent name/ID, or --all",
          );

        const host = await resolveSshHost(deps, opts.server);
        const paths = sshPaths();
        await orExit(ensureKeyPair(paths), (e) => e.message);

        if (opts.all) {
          const listed = await deps.createAgentService(host).list();
          if (!listed.ok) {
            printServiceError(listed.error, host);
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          if (listed.value.length === 0) {
            process.stdout.write("No agents to configure.\n");
            process.exit(0);
          }
          // Sequential: each call read-modify-writes the shared ssh_config, so
          // concurrent writes would clobber each other's blocks.
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
          process.stdout.write(
            `Configured ${rows.length} SSH host${rows.length === 1 ? "" : "s"}:\n` +
              rows.map((r) => `  ${r.alias}  (${r.name})`).join("\n") +
              "\n",
          );
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

  // `_proxy` is the ssh ProxyCommand the connect/editor forms re-invoke — an
  // implementation detail, not run by hand, so it stays hidden from help.
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

/** Spawn an external client (`ssh`/`code`) inheriting the terminal and exit
 *  with its code. Resolves never — every exit path goes through process.exit.
 *  A missing binary is the common setup error, so name it clearly. */
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
