import { agentInstructionsEventPayload } from "agent-runtime-api";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "agent-runtime-api";
import { eventPlugin } from "../infrastructure/plugin-registry.js";

const IMPL_NAME = "agent-instructions";

const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";

export function createAgentInstructionsPlugin(deps: {
  log: (msg: string) => void;
}): Plugin {
  return eventPlugin(IMPL_NAME, "agent-instructions", async (payload, ctx) => {
    const { content } = agentInstructionsEventPayload.parse(payload);
    const path = join(ctx.agentHome, AGENT_INSTRUCTIONS_FILE);
    try {
      await writeFile(path, content, { flag: "wx" });
      deps.log(`[agent-instructions] wrote ${path}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      deps.log(`[agent-instructions] ${path} exists, keeping it`);
    }
  });
}
