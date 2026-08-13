import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSupervised } from "../../../core/supervised-process.js";
import type {
  DriverBinding,
  EventHandler,
  Plugin,
  WorkspaceCommandEventPayload,
} from "agent-runtime-api";

const IMPL_NAME = "workspace-command";

const DONE_SENTINEL = "command.done";

const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

export type RunCommandFn = (
  command: string,
  cwd: string,
  log: (msg: string) => void,
) => Promise<void>;

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
        if (await sentinelExists(sentinel)) {
          deps.log(`[workspace-command] already run, skipping`);
          return;
        }
        deps.log(`[workspace-command] running in ${deps.workDir}: ${command}`);
        await run(command, deps.workDir, deps.log);
        try {
          await writeFile(sentinel, `${new Date().toISOString()}\n`, {
            flag: "wx",
          });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        deps.log(`[workspace-command] completed`);
      };
    },
  };
}

async function sentinelExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

function runCommand(
  command: string,
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const supervised = spawnSupervised("bash", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc = supervised.child;
    const relay = (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(/\n$/, "");
      if (text) log(`[workspace-command] ${text}`);
    };
    proc.stdout?.on("data", relay);
    proc.stderr?.on("data", relay);
    const timer = setTimeout(() => {
      // A hanging setup command is usually hanging *in* something it spawned.
      void supervised.terminate({ log });
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
      // No sweep on exit: a setup command that means to leave a service running
      // declares it with `platform-bg`, which this inherits the env to reach.
      if (code === 0) resolve();
      else reject(new Error(`workspace command exited with code ${code}`));
    });
  });
}
