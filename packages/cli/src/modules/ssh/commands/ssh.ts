import { spawn } from "node:child_process";
import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
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
  ensureManagedSshHost,
  gatewayConnectUrl,
  REMOTE_WORK_DIR,
} from "../infrastructure/launch.js";

export interface SshDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

const MODES = ["ssh", "code", "zed", "jetbrains"] as const;
type LaunchMode = (typeof MODES)[number];
const MODE_BINS: Record<LaunchMode, readonly string[]> = {
  ssh: ["ssh"],
  code: ["code", "code-insiders"],
  zed: ["zed"],
  jetbrains: [
    "gateway",
    "pycharm",
    "idea",
    "goland",
    "webstorm",
    "phpstorm",
    "clion",
    "rubymine",
    "rider",
    "datagrip",
    "rustrover",
    "dataspell",
    "aqua",
  ],
};

export function inferMode(base: string): LaunchMode | undefined {
  return MODES.find((m) => MODE_BINS[m].includes(base));
}

export function buildSshCommand(deps: SshDeps): Command {
  const ssh = new Command("ssh").description("Open or wire up SSH access to an agent");
  ssh.addCommand(buildConnectCommand(deps));
  ssh.addCommand(buildConfigureCommand(deps));
  // `_proxy` is the ssh ProxyCommand the connect/editor forms re-invoke; it's an
  // implementation detail, not run by hand, so it stays hidden from help.
  ssh.addCommand(buildProxyCommand(deps), { hidden: true });
  return ssh;
}

function buildConnectCommand(deps: SshDeps): Command {
  return new Command("connect")
    .description("Open an SSH session to an agent, or launch an editor/IDE against it")
    .argument("<agent>", "agent name or ID")
    .option(
      "-x, --exec <bin[:mode]>",
      `client to launch: executable name or path, optionally suffixed with ":${MODES.join(
        "|",
      )}" to force how it's invoked; the mode is otherwise inferred from the name (e.g. code-insiders → code, pycharm → jetbrains)`,
    )
    .option("--server <url>", "override the configured server URL")
    .action(
      async (agentRef: string, opts: { exec?: string; server?: string }) => {
        const { mode, exec } = resolveLaunchTarget(opts.exec);
        return runLaunch(deps, agentRef, opts.server, mode, exec);
      },
    );
}

function buildConfigureCommand(deps: SshDeps): Command {
  return new Command("configure")
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
        return runConfigure(deps, { agentRef, all: opts.all }, opts.server);
      },
    );
}

function buildProxyCommand(deps: SshDeps): Command {
  return new Command("_proxy")
    .description("Internal: act as an ssh ProxyCommand — tunnel stdin/stdout to the agent")
    .argument("<agent>", "agent name or ID")
    .option("--server <url>", "override the configured server URL")
    .action(async (agentRef: string, opts: { server?: string }) =>
      runProxy(deps, agentRef, opts.server),
    );
}

/** Resolve the `--exec` value into a (mode, binary) pair. The value is a binary
 *  name or path with an optional `:<mode>` suffix that forces the mode; without
 *  it the mode is inferred from the binary's basename. */
function resolveLaunchTarget(execFlag: string | undefined): {
  mode: LaunchMode;
  exec: string;
} {
  if (!execFlag) return { mode: "ssh", exec: "ssh" };
  const forced = execFlag.match(new RegExp(`^(.+):(${MODES.join("|")})$`));
  if (forced) return { mode: forced[2] as LaunchMode, exec: forced[1]! };
  const base = execFlag.split(/[/\\]/).pop()!.toLowerCase();
  const inferred = inferMode(base);
  if (!inferred)
    die(
      `could not infer mode from --exec "${execFlag}"; append ":${MODES.join(
        "|",
      )}" to force one`,
    );
  return { mode: inferred, exec: execFlag };
}

async function runProxy(
  deps: SshDeps,
  agentRef: string,
  serverFlag?: string,
): Promise<never> {
  const host = await resolveHostFromConfig(deps, {
    flag: serverFlag ? { server: serverFlag } : undefined,
    exitCodes: { runtimeFailure: EXIT_RUNTIME_FAILURE },
  });
  const paths = sshPaths();
  const [agent, publicKey, tok] = await Promise.all([
    resolveAgent(deps, host, agentRef),
    orExit(ensureKeyPair(paths), (e) => e.message),
    deps.tokenProvider.getValidAccessToken(host),
  ]);
  if (!tok.ok)
    die(`not authenticated (${tok.error.kind}); run \`dam auth login\` first`);
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
}

async function runLaunch(
  deps: SshDeps,
  agentRef: string,
  serverFlag: string | undefined,
  mode: LaunchMode,
  exec: string,
): Promise<never> {
  const host = await resolveActiveHost(deps, {
    flag: serverFlag ? { server: serverFlag } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
  const paths = sshPaths();
  await Promise.all([
    resolveAgent(deps, host, agentRef), // early "not found" before handoff
    orExit(ensureKeyPair(paths), (e) => e.message),
  ]);

  const label = `\`${exec}\``;
  if (mode === "ssh")
    return handoff(exec, buildSshArgs({ agentRef, serverFlag, paths }), label);
  const alias = await ensureManagedSshHost({ agentRef, serverFlag, paths });
  return handoff(exec, clientArgs(mode, alias), label);
}

/** Argv for an editor/IDE client launching against the managed host `alias`.
 *  Each client takes the agent's workspace as a remote target it resolves from
 *  the user's `~/.ssh/config` (so they share the alias's ProxyCommand). */
function clientArgs(mode: Exclude<LaunchMode, "ssh">, alias: string): string[] {
  switch (mode) {
    case "zed":
      return [`ssh://agent@${alias}${REMOTE_WORK_DIR}`];
    case "jetbrains":
      return [gatewayConnectUrl(alias)];
    case "code":
      return ["--remote", `ssh-remote+${alias}`, REMOTE_WORK_DIR];
  }
}

/** Write the dam-managed SSH host block(s) and report the alias(es), without
 *  launching any client — for wiring up editors/tools by hand. Configures a
 *  single agent, or every agent on the host with `--all`. */
async function runConfigure(
  deps: SshDeps,
  target: { agentRef?: string; all?: boolean },
  serverFlag?: string,
): Promise<never> {
  const host = await resolveActiveHost(deps, {
    flag: serverFlag ? { server: serverFlag } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
  const paths = sshPaths();
  await orExit(ensureKeyPair(paths), (e) => e.message);

  if (target.all) {
    const listed = await deps.createAgentService(host).list();
    if (!listed.ok) {
      printServiceError(listed.error, host);
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    if (listed.value.length === 0) {
      process.stdout.write("No agents to configure.\n");
      process.exit(0);
    }
    // Sequential: each call read-modify-writes the shared dam/user ssh_config,
    // so concurrent writes would clobber each other's blocks.
    const rows: { name: string; alias: string }[] = [];
    for (const a of listed.value)
      rows.push({
        name: a.name,
        alias: await ensureManagedSshHost({
          agentRef: a.name,
          serverFlag,
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

  const agentRef = target.agentRef!;
  const agent = await resolveAgent(deps, host, agentRef);
  const alias = await ensureManagedSshHost({ agentRef, serverFlag, paths });
  process.stdout.write(
    `Configured SSH host "${alias}" for agent "${agent.name}". Connect with:\n` +
      `  ssh ${alias}\n` +
      `  code --remote ssh-remote+${alias} ${REMOTE_WORK_DIR}\n` +
      `  zed ssh://agent@${alias}${REMOTE_WORK_DIR}\n` +
      `  gateway ${gatewayConnectUrl(alias)}\n`,
  );
  process.exit(0);
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
