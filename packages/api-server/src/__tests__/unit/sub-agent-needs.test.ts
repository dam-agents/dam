import { describe, expect, test } from "vitest";
import { spawnInvocationRequestSchema } from "api-server-api";
import { unmetNeed } from "../../apps/harness-api-server/sub-agent-tools.js";
import type { SpawnRequest } from "../../apps/harness-api-server/driver-ops.js";

/**
 * TEST_OVERVIEW: The needs gate on spawn_subagent refuses a stated need the
 * request does not bear out, and passes the needs the request cannot show.
 */

const base: SpawnRequest = spawnInvocationRequestSchema.parse({
  prompt: "do it",
  schema: { type: "integer" },
  harness: "claude-code",
});

describe("unmetNeed", () => {
  test("different-harness on the caller's own harness is refused", () => {
    expect(unmetNeed(["different-harness"], base, "claude-code")).toMatch(
      /your own harness/,
    );
  });

  test("different-harness on another harness passes", () => {
    expect(unmetNeed(["different-harness"], base, "codex")).toBeNull();
  });

  test("different-harness with an unknown own harness passes", () => {
    expect(unmetNeed(["different-harness"], base, null)).toBeNull();
  });

  test("different-harness without a harness is refused", () => {
    const { harness: _harness, ...noHarness } = base;
    expect(
      unmetNeed(["different-harness"], { ...noHarness, image: "x" }, "codex"),
    ).toMatch(/names no harness/);
  });

  test("own-setup needs seed, install, env or skills", () => {
    expect(unmetNeed(["own-setup"], base, "codex")).toMatch(/own-setup/);
    expect(
      unmetNeed(["own-setup"], { ...base, install: { command: "make" } }, null),
    ).toBeNull();
    expect(
      unmetNeed(
        ["own-setup"],
        { ...base, env: [{ name: "A", value: "1" }] },
        null,
      ),
    ).toBeNull();
  });

  test("more-resources needs resources, cpu, memory or a vm backend", () => {
    expect(unmetNeed(["more-resources"], base, null)).toMatch(/more-resources/);
    expect(
      unmetNeed(["more-resources"], { ...base, resources: { cpu: "4" } }, null),
    ).toBeNull();
    expect(
      unmetNeed(["more-resources"], { ...base, backend: "vm" }, null),
    ).toBeNull();
  });

  test("isolation, parallel and checked-result pass as stated", () => {
    expect(
      unmetNeed(
        ["isolation", "parallel", "checked-result"],
        base,
        "claude-code",
      ),
    ).toBeNull();
  });

  test("the first unmet need is reported when several are stated", () => {
    expect(unmetNeed(["isolation", "own-setup"], base, null)).toMatch(
      /own-setup/,
    );
  });
});
