import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DriverBinding,
  EventHandler,
  Plugin,
  WorkspaceCommandEventPayload,
} from "agent-runtime-api";

const IMPL_NAME = "workspace-command";

// Run-to-success is enforced by this sentinel in the plugin's state dir (on
// the PVC), independent of outbox settle: a pod killed after the command
// succeeded but before the event settled won't re-run it on the next wake.
const DONE_SENTINEL = "command.done";

// Bootstraps can clone + install; give them ample room. A hung command is
// killed so the event can be retried on a later wake rather than wedging.
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

// Runs `command` to completion in `cwd`; rejects on a non-zero exit, spawn
// error, or timeout. Injectable for tests (the default shells out to bash).
export type RunCommandFn = (
  command: string,
  cwd: string,
  log: (msg: string) => void,
) => Promise<void>;

// Event driver for `workspace-command`: run a platform-composed shell command
// once in the work dir (e.g. a Knowledge Base's bootstrap installer). Runs in
// the pod's environment, so egress rides the paired gateway exactly as a
// harness process would. Never re-asserted — the command's effects are the
// user's mutable workspace.
export function createWorkspaceCommandPlugin(deps: {
  workDir: string;
  log: (msg: string) => void;
  run?: RunCommandFn;
}): Plugin {
  const run = deps.run ?? runCommand;
  return {
    name: IMPL_NAME,
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "workspace-command") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload, ctx) => {
        const { command } = payload as WorkspaceCommandEventPayload;
        const sentinel = join(ctx.pluginStateDir, DONE_SENTINEL);
        if (existsSync(sentinel)) {
          deps.log(`[workspace-command] already run, skipping`);
          return;
        }
        deps.log(`[workspace-command] running in ${deps.workDir}: ${command}`);
        await run(command, deps.workDir, deps.log);
        await writeFile(sentinel, `${new Date().toISOString()}\n`);
        deps.log(`[workspace-command] completed`);
      };
    },
  };
}

// `bash -lc` so the command sees the same login-shell environment an
// interactive terminal/SSH session gets (mise-managed tools on PATH, etc.).
// Output is streamed to the pod log for diagnosis; a non-zero exit, spawn
// error, or timeout throws so the event stays pending and retries.
function runCommand(
  command: string,
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const relay = (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(/\n$/, "");
      if (text) log(`[workspace-command] ${text}`);
    };
    proc.stdout?.on("data", relay);
    proc.stderr?.on("data", relay);
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new Error(`workspace command timed out after ${COMMAND_TIMEOUT_MS}ms`),
      );
    }, COMMAND_TIMEOUT_MS);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`workspace command exited with code ${code}`));
    });
  });
}
