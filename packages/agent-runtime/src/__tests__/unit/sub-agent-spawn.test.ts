import { describe, expect, it } from "vitest";
import { subAgentSpawnIn } from "../../modules/acp/infrastructure/sub-agent-spawn.js";

/**
 * TEST_OVERVIEW: The spawn-line reader that lets an outcome delivered later
 * land in the Session that asked for it. It reads only a finished tool call's
 * output, takes the `[invoke] spawned <label> -> <id>` lines both the
 * spawn_subagent tool and the driver SDK print, with or without a script's
 * line-number prefix, and names each id once.
 */

const SESSION = "abe53601-a7a2-4d17-9726-d93af979937a";

function frame(
  update: Record<string, unknown>,
  sessionId: string | null = SESSION,
) {
  return {
    method: "session/update",
    params: {
      ...(sessionId ? { sessionId } : {}),
      update: {
        sessionUpdate: "tool_call_update",
        status: "completed",
        ...update,
      },
    },
  };
}

describe("subAgentSpawnIn", () => {
  it("reads the id from a tool result's spawn line", () => {
    expect(
      subAgentSpawnIn(
        frame({
          rawOutput: "[invoke] spawned six -> agent-aaaa1111\nneeds: isolation",
        }),
      ),
    ).toEqual({ sessionId: SESSION, subAgentIds: ["agent-aaaa1111"] });
  });

  it("reads every id once across text blocks, with or without a line-number prefix", () => {
    expect(
      subAgentSpawnIn(
        frame({
          rawOutput: [
            {
              type: "text",
              text: "     1\t[invoke] spawned slow -> agent-cccc3333",
            },
            {
              type: "text",
              text: "[invoke] spawned six -> agent-aaaa1111\n[invoke] spawned six -> agent-aaaa1111",
            },
            { type: "image", data: "..." },
          ],
        }),
      ),
    ).toEqual({
      sessionId: SESSION,
      subAgentIds: ["agent-cccc3333", "agent-aaaa1111"],
    });
  });

  it("ignores a call that is still running", () => {
    expect(
      subAgentSpawnIn(
        frame({
          status: "in_progress",
          rawOutput: "[invoke] spawned six -> agent-aaaa1111",
        }),
      ),
    ).toBeNull();
  });

  it("ignores updates that are not tool call updates", () => {
    expect(
      subAgentSpawnIn(
        frame({
          sessionUpdate: "agent_message_chunk",
          rawOutput: "[invoke] spawned six -> agent-aaaa1111",
        }),
      ),
    ).toBeNull();
  });

  it("ignores a frame with no session and output with no spawn line", () => {
    expect(
      subAgentSpawnIn(
        frame({ rawOutput: "[invoke] spawned six -> agent-aaaa1111" }, null),
      ),
    ).toBeNull();
    expect(subAgentSpawnIn(frame({ rawOutput: "all done" }))).toBeNull();
    expect(subAgentSpawnIn(frame({}))).toBeNull();
  });
});
