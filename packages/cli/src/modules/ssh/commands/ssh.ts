import { spawn } from "node:child_process";
import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { createAgentTrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { connectRawBridge } from "../infrastructure/raw-bridge.js";
import {
  ensureKeyPair,
  sshPaths,
  type SshPaths,
} from "../infrastructure/ssh-keys.js";
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

export function buildSshCommand(deps: SshDeps): Command {
  return new Command("ssh")
    .description("Open an SSH session to an agent")
    .argument("<agent>", "agent name or ID")
    .option(
      "--proxy",
      "act as an ssh ProxyCommand — tunnel stdin/stdout to the agent (used by ssh, not run directly)",
    )
    .option("--code", "open the agent in VS Code via Remote-SSH")
    .option(
      "--code-insiders",
      "open the agent in VS Code Insiders via Remote-SSH",
    )
    .option("--zed", "open the agent in Zed via remote SSH")
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        agentRef: string,
        opts: {
          proxy?: boolean;
          code?: boolean;
          codeInsiders?: boolean;
          zed?: boolean;
          server?: string;
        },
      ) => {
        const modes = (
          ["proxy", "code", "codeInsiders", "zed"] as const
        ).filter((k) => opts[k]);
        if (modes.length > 1) {
          process.stderr.write(
            "error: only one of --proxy, --code, --code-insiders, --zed may be set\n",
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        }
        if (opts.proxy) return runProxy(deps, agentRef, opts.server);
        const mode = modes[0];
        const editor =
          mode === "code" || mode === "codeInsiders" || mode === "zed"
            ? EDITORS[mode]
            : undefined;
        return runLaunch(deps, agentRef, opts.server, editor);
      },
    );
}

/** How an editor is launched against the managed SSH host alias. */
type EditorTarget =
  | { kind: "remote-ssh"; bin: string; label: string }
  | { kind: "zed"; bin: "zed"; label: string };

const EDITORS = {
  code: { kind: "remote-ssh", bin: "code", label: "VS Code CLI (`code`)" },
  codeInsiders: {
    kind: "remote-ssh",
    bin: "code-insiders",
    label: "VS Code Insiders CLI (`code-insiders`)",
  },
  zed: { kind: "zed", bin: "zed", label: "Zed CLI (`zed`)" },
} as const satisfies Record<string, EditorTarget>;

/** ProxyCommand transport: resolve, register the dam key, tunnel raw bytes.
 *  stdout is the SSH wire — only relayed bytes go there; all else to stderr. */
async function runProxy(
  deps: SshDeps,
  agentRef: string,
  serverFlag?: string,
): Promise<never> {
  const { host, agent, publicKey } = await prepareLaunch(
    deps,
    agentRef,
    serverFlag,
  );
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

/** Hand off to a client that connects through the dam ProxyCommand. Without an
 *  editor: the system `ssh` (interactive). With one: materialize the managed
 *  `~/.ssh/config` host, then launch the editor against the alias (VS Code via
 *  `--remote ssh-remote+<alias>`, Zed via an `ssh://` URL). */
async function runLaunch(
  deps: SshDeps,
  agentRef: string,
  serverFlag: string | undefined,
  editor?: EditorTarget,
): Promise<never> {
  const { paths } = await prepareLaunch(deps, agentRef, serverFlag);
  if (!editor)
    return handoff(
      "ssh",
      buildSshArgs({ agentRef, serverFlag, paths }),
      "OpenSSH client (`ssh`)",
    );
  const alias = await ensureManagedSshHost({ agentRef, serverFlag, paths });
  const args =
    editor.kind === "zed"
      ? [`ssh://agent@${alias}${REMOTE_WORK_DIR}`]
      : ["--remote", `ssh-remote+${alias}`, REMOTE_WORK_DIR];
  return handoff(editor.bin, args, editor.label);
}

/** Shared bootstrap for every path: compat gate, resolve the agent, ensure the
 *  dam keypair. Returns what each path needs (proxy uses host/agent/publicKey;
 *  interactive/editor use paths). */
async function prepareLaunch(
  deps: SshDeps,
  agentRef: string,
  serverFlag?: string,
): Promise<{
  host: string;
  agent: { id: string; name: string };
  paths: SshPaths;
  publicKey: string;
}> {
  const host = await resolveActiveHost(deps, {
    flag: serverFlag ? { server: serverFlag } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_RUNTIME_FAILURE,
      belowFloor: EXIT_BELOW_FLOOR,
    },
  });
  const resolver = createAgentResolver({
    agentService: deps.createAgentService(host),
  });
  const resolved = await resolver.resolve(agentRef);
  if (!resolved.ok) {
    printResolveError(resolved.error, host);
    process.exit(exitCodeForResolveError(resolved.error));
  }
  const paths = sshPaths();
  const publicKey = await orExit(ensureKeyPair(paths), (e) => e.message);
  return { host, agent: resolved.value, paths, publicKey };
}

/** Await a promise, or print `error: <msg>` and exit on rejection. */
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
