import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventContext } from "agent-runtime-api";
import { createAgentInstructionsPlugin } from "../../modules/runtime-channel/drivers/agent-instructions-plugin.js";

function setup() {
  const home = mkdtempSync(join(tmpdir(), "agent-instructions-"));
  const handler = createAgentInstructionsPlugin({ log: () => {} }).bindEvent!(
    "agent-instructions",
    { impl: "agent-instructions" },
  );
  const ctx: EventContext = {
    eventId: "agent-instructions:a:1",
    agentHome: home,
    pluginStateDir: join(home, "state"),
    log: () => {},
  };
  return {
    seed: (content: string) => handler({ content }, ctx),
    file: join(home, "AGENTS.md"),
  };
}

describe("agent-instructions plugin", () => {
  it("writes the template to AGENTS.md in the home", async () => {
    const { seed, file } = setup();
    await seed("# AGENTS.md\n");
    expect(readFileSync(file, "utf8")).toBe("# AGENTS.md\n");
  });

  // TEST_SCENARIO: the owner already wrote their instructions, so a redelivered template event must leave the file as it is.
  it("keeps an AGENTS.md that already exists", async () => {
    const { seed, file } = setup();
    writeFileSync(file, "mine\n");
    await seed("# AGENTS.md\n");
    expect(readFileSync(file, "utf8")).toBe("mine\n");
  });
});
