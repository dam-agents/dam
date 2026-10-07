import { describe, expect, test } from "vitest";

import {
  fanOutOwners,
  parseFanOut,
} from "../../modules/invocations/lib/fan-out.js";
import type { Message, ToolChip } from "../../types.js";

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

  test("reads the lines a file read numbers", () => {
    const spawns = parseFanOut(
      chip(
        "     1\t[invoke] spawned slow -> agent-cccc3333\n     2\t[invoke] done slow (agent-cccc3333)",
      ),
    );
    expect(spawns).toEqual([{ id: "agent-cccc3333", label: "slow" }]);
  });

  test("reads the Python SDK's spawned lines", () => {
    const spawns = parseFanOut(
      chip(
        "[invoke] spawned six (agent-dddd4444)\n[invoke] six (agent-dddd4444) done",
      ),
    );
    expect(spawns).toEqual([{ id: "agent-dddd4444", label: "six" }]);
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

describe("fanOutOwners gives each child to the first chip that names it", () => {
  function message(id: string, parts: ToolChip[]): Message {
    return { id, role: "assistant", parts } as Message;
  }

  test("a later chip naming the same child does not own it", () => {
    const first = chip("[invoke] spawned six -> agent-aaaa1111");
    const again = chip(
      "1\t[invoke] spawned six -> agent-aaaa1111\n2\t[invoke] spawned eight -> agent-bbbb2222",
    );
    const owners = fanOutOwners([
      message("m1", [first]),
      message("m2", [again]),
    ]);
    expect(owners.get("agent-aaaa1111")).toBe(first);
    expect(owners.get("agent-bbbb2222")).toBe(again);
  });
});
