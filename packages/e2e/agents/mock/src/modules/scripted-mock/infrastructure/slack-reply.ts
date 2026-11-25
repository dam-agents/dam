import type {
  PlatformToolCaller,
  SlackReplyPoster,
} from "../services/ports.js";

export function createSlackReplyPoster(
  callTool: PlatformToolCaller,
): SlackReplyPoster {
  return async ({ text, threadTs }) => {
    try {
      await callTool("reply", { text, ...(threadTs ? { threadTs } : {}) });
    } catch (err) {
      process.stderr.write(
        `[mock-agent] Slack reply failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  };
}
