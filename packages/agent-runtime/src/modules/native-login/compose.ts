import type { NativeLoginService, NativeLoginStatus } from "agent-runtime-api";
import type { runOnce } from "../../core/run-once.js";

/** UNIT_BOUNDARY_DESCRIPTION: Reports only whether this agent's Codex recognizes a saved ChatGPT login. The CLI owns credential access; its output, including key fragments from other auth modes, never reaches clients or logs. */
export function createNativeLoginService(deps: {
  run: typeof runOnce;
  env: () => NodeJS.ProcessEnv;
}): NativeLoginService {
  return {
    async status() {
      const result = await deps.run({
        command: ["/usr/local/bin/codex-chatgpt", "login", "status"],
        env: deps.env(),
        timeoutMs: 5000,
        maxOutputBytes: 4096,
      });
      let state: NativeLoginStatus["state"] = "unavailable";
      if (result.ok) {
        const output = result.value.stderr.trim();
        if (output === "Logged in using ChatGPT") state = "signed-in";
        else if (output.startsWith("Logged in using "))
          state = "sign-in-required";
      } else if (
        result.error.kind === "exited" &&
        result.error.code === 1 &&
        result.error.stderr.trim() === "Not logged in"
      ) {
        state = "sign-in-required";
      }
      return { state, checkedAt: new Date().toISOString() };
    },
  };
}
