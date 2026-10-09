import { describe, it, expect, vi } from "vitest";
import { executeBackgroundWorkRead } from "../../modules/agents/services/agents-service.js";

const HELD = {
  sessions: [
    {
      sessionId: "sess-1",
      items: [
        { id: "job-1", description: "npm run e2e", command: "npm run e2e" },
      ],
    },
  ],
  keptProcesses: 1,
};

const NOTHING_HELD = { sessions: [], keptProcesses: 0 };

describe("agents.backgroundWork read", () => {
  it("returns the pod-reported sets and kept process count for a running agent", async () => {
    const read = executeBackgroundWorkRead({
      getAgent: async () => ({ hibernated: false }),
      podStatus: { backgroundWork: async () => HELD },
    });
    expect(await read("agent-1")).toEqual(HELD);
  });

  it("answers nothing held for a hibernated agent without touching the pod — the read must never wake it", async () => {
    const probe = vi.fn();
    const read = executeBackgroundWorkRead({
      getAgent: async () => ({ hibernated: true }),
      podStatus: { backgroundWork: probe },
    });
    expect(await read("agent-1")).toEqual(NOTHING_HELD);
    expect(probe).not.toHaveBeenCalled();
  });

  it("fails soft to nothing held when the pod doesn't answer (starting, rolling, unreachable)", async () => {
    const read = executeBackgroundWorkRead({
      getAgent: async () => ({ hibernated: false }),
      podStatus: {
        backgroundWork: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    expect(await read("agent-1")).toEqual(NOTHING_HELD);
  });
});
