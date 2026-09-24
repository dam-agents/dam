import { describe, expect, test } from "vitest";

import { parseFanOut } from "../../modules/invocations/lib/fan-out.js";
import type { ToolChip } from "../../types.js";

function chip(text: string): ToolChip {
  return {
    kind: "tool",
    title: "node ~/spawn.mjs",
    status: "completed",
    content: [{ type: "content", text }],
  };
}

describe("parseFanOut recognises the SDK's progress lines in a tool chip", () => {
  test("returns one spawn per child, in order, from the spawned lines", () => {
    const spawns = parseFanOut(
      chip(
        [
          "[invoke] spawned six -> agent-aaaa1111",
          "[invoke] spawned eight -> agent-bbbb2222",
          "[invoke] done six (agent-aaaa1111)",
          "[invoke] done eight (agent-bbbb2222)",
        ].join("\n"),
      ),
    );
    expect(spawns).toEqual([
      { id: "agent-aaaa1111", label: "six" },
      { id: "agent-bbbb2222", label: "eight" },
    ]);
  });

  test("dedupes a child whose line was printed twice", () => {
    const spawns = parseFanOut(
      chip(
        "[invoke] spawned six -> agent-aaaa1111\n[invoke] spawned six -> agent-aaaa1111",
      ),
    );
    expect(spawns).toHaveLength(1);
  });

  test("ignores the skill's documentation line and ordinary output", () => {
    expect(
      parseFanOut(
        chip(
          "Progress lines (`[invoke] spawned ... -> agent-xxx`,\nnpm WARN deprecated",
        ),
      ),
    ).toBeNull();
    expect(parseFanOut(chip("total 12\ndrwxr-xr-x work"))).toBeNull();
  });

  test("a chip with no content is not a fan-out", () => {
    expect(
      parseFanOut({ kind: "tool", title: "ls", status: "completed" }),
    ).toBeNull();
  });
});
