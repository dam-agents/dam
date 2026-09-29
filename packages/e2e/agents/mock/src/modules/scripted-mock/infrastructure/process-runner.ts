import { execFile } from "node:child_process";
import type { ProcessRunner } from "../services/ports.js";

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
  };
}
