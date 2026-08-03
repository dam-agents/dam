import { execFile, spawn } from "node:child_process";
import { openSync } from "node:fs";
import type { ProcessRunner } from "../services/ports.js";

/** Real subprocess execution for the experiment directives: plan-mode scripts
 *  run to completion (they exit after registering), run-mode scripts start
 *  detached exactly like a real harness backgrounds them — the mock's turn
 *  ends while the loop keeps reporting to the platform on its own. */
export function createProcessRunner(cwd: string): ProcessRunner {
  return {
    run({ command, args, env, timeoutMs }) {
      return new Promise((resolve) => {
        execFile(
          command,
          args,
          {
            cwd,
            env: { ...process.env, ...env },
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
          },
          (err, stdout, stderr) => {
            const code =
              err && typeof (err as { code?: unknown }).code === "number"
                ? ((err as { code?: number }).code ?? 1)
                : err
                  ? 1
                  : 0;
            resolve({ code, output: `${stdout}${stderr}`.slice(-2000) });
          },
        );
      });
    },

    spawnDetached({ command, args, env, logPath }) {
      const log = openSync(logPath, "a");
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: ["ignore", log, log],
      });
      child.unref();
    },
  };
}
