import { spawn } from "node:child_process";
import { Command, Option } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
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
  REMOTE_WORK_DIR,
} from "../infrastructure/launch.js";

export interface SshDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

const MODES = ["ssh", "code", "zed"] as const;
type LaunchMode = (typeof MODES)[number];

export function buildSshCommand(deps: SshDeps): Command {
  return new Command("ssh")
    .description("Open an SSH session to an agent")
    .argument("<agent>", "agent name or ID")
    .option(
      "-m, --mode <mode>",
      `client to launch: ${MODES.join(" | ")} (inferred from --exec, else "ssh")`,
    )
    .option(
      "-x, --exec <path>",
      "executable to run (path or name); defaults to the mode name",
    )
    .addOption(
      new Option(
        "--proxy",
        "act as an ssh ProxyCommand — tunnel stdin/stdout to the agent",
      ).hideHelp(),
    )
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        agentRef: string,
        opts: {
          mode?: string;
          exec?: string;
          proxy?: boolean;
          server?: string;
        },
      ) => {
        if (opts.proxy) {
          if (opts.mode || opts.exec) {
            process.stderr.write(
              "error: --proxy cannot be combined with --mode/--exec\n",
            );
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          return runProxy(deps, agentRef, opts.server);
        }
        const target = resolveLaunchTarget(opts.mode, opts.exec);
        if (!target.ok) {
          process.stderr.write(`error: ${target.error}\n`);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        return runLaunch(deps, agentRef, opts.server, target.mode, target.exec);
      },
    );
}

function resolveLaunchTarget(
  modeFlag: string | undefined,
  execFlag: string | undefined,
): { ok: true; mode: LaunchMode; exec: string } | { ok: false; error: string } {
  if (modeFlag && !MODES.includes(modeFlag as LaunchMode))
    return {
      ok: false,
      error: `invalid --mode "${modeFlag}"; expected one of ${MODES.join(", ")}`,
    };
  const mode = modeFlag as LaunchMode | undefined;
  if (mode) return { ok: true, mode, exec: execFlag ?? mode };
  if (!execFlag) return { ok: true, mode: "ssh", exec: "ssh" };
  const base = execFlag.split(/[/\\]/).pop()!.toLowerCase();
  const inferred = MODES.find((m) => base.includes(m));
  if (!inferred)
    return {
      ok: false,
      error: `could not infer --mode from --exec "${execFlag}"; pass --mode explicitly`,
    };
  return { ok: true, mode: inferred, exec: execFlag };
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
  const agent = await resolveAgent(deps, host, agentRef);
  const paths = sshPaths();
  const publicKey = await orExit(ensureKeyPair(paths), (e) => e.message);
  const tok = await deps.tokenProvider.getValidAccessToken(host);
  if (!tok.ok) {
    process.stderr.write(
      `error: not authenticated (${tok.error.kind}); run \`dam auth login\` first\n`,
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }
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
  await resolveAgent(deps, host, agentRef); // early "not found" before handoff
  const paths = sshPaths();
  await orExit(ensureKeyPair(paths), (e) => e.message);

  const label = `\`${exec}\``;
  if (mode === "ssh")
    return handoff(exec, buildSshArgs({ agentRef, serverFlag, paths }), label);
  const alias = await ensureManagedSshHost({ agentRef, serverFlag, paths });
  const args =
    mode === "zed"
      ? [`ssh://agent@${alias}${REMOTE_WORK_DIR}`]
      : ["--remote", `ssh-remote+${alias}`, REMOTE_WORK_DIR];
  return handoff(exec, args, label);
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

async function orExit<T>(p: Promise<T>, msg: (e: Error) => string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    process.stderr.write(`error: ${msg(e as Error)}\n`);
    process.exit(EXIT_RUNTIME_FAILURE);
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
