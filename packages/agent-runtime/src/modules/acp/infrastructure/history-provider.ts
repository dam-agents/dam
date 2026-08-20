import { spawn } from "node:child_process";

export interface HistoryProvider {
  fetch(sessionId: string): Promise<string[] | null>;
}

export interface ExecHistoryProviderDeps {
  command: readonly string[];
  cwd: string;
  timeoutMs?: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs the harness image's declared session-history
 * command (runtime-manifest `sessionHistory.command`) to read one session's
 * replay without touching the harness process. The command receives the
 * session id as its final argument and must print one `session/update`
 * JSON-RPC frame per line for that session. Any deviation — non-zero exit,
 * timeout, malformed or foreign frames — resolves to null so the caller falls
 * back to the harness `session/load`; the provider accelerates, it never
 * decides.
 */
export function createExecHistoryProvider(
  deps: ExecHistoryProviderDeps,
): HistoryProvider {
  const timeoutMs = deps.timeoutMs ?? 15_000;
  return {
    fetch(sessionId) {
      return new Promise((resolve) => {
        const [bin, ...args] = deps.command;
        if (!bin) {
          resolve(null);
          return;
        }
        const child = spawn(bin, [...args, sessionId], {
          cwd: deps.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (lines: string[] | null, reason?: string): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (reason) deps.log(`history provider for ${sessionId}: ${reason}`);
          resolve(lines);
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(null, `timed out after ${timeoutMs}ms`);
        }, timeoutMs);
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (error) =>
          finish(null, `failed to start: ${error.message}`),
        );
        child.on("close", (code) => {
          if (code !== 0) {
            finish(null, `exited ${code}: ${stderr.trim().slice(0, 200)}`);
            return;
          }
          const lines: string[] = [];
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            let frame: unknown;
            try {
              frame = JSON.parse(line);
            } catch {
              finish(null, "emitted a non-JSON line");
              return;
            }
            const f = frame as {
              method?: unknown;
              params?: { sessionId?: unknown };
            };
            if (
              f.method !== "session/update" ||
              f.params?.sessionId !== sessionId
            ) {
              finish(null, "emitted an unexpected frame");
              return;
            }
            lines.push(line);
          }
          finish(lines);
        });
      });
    },
  };
}
