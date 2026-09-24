import { workspaceCommandEventPayload } from "agent-runtime-api";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DriverBinding,
  EventHandler,
  Plugin,
  WorkspaceCommandEventPayload,
} from "agent-runtime-api";

import { describeFailure, runOnce } from "../../../core/run-once.js";

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
        const { command } = workspaceCommandEventPayload.parse(payload);
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

const TAIL_LINES = 10;
const TAIL_CHARS = 500;

export async function runCommand(
  command: string,
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  const argv = ["bash", "-lc", command];
  const tail: string[] = [];
  const result = await runOnce({
    command: argv,
    cwd,
    timeoutMs: COMMAND_TIMEOUT_MS,
    onLine: (line) => {
      log(`[workspace-command] ${line}`);
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
    },
  });
  if (!result.ok) {
    const output = tail.join("\n").trim().slice(-TAIL_CHARS);
    const reason = describeFailure("workspace command", result.error);
    throw new Error(output ? `${reason}: ${output}` : reason);
  }
}
