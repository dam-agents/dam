// TEST_OVERVIEW: `dam onboarding first-result` records the first result the
// TEST_OVERVIEW: assistant reached — a schedule set, an artifact made, a saved
// TEST_OVERVIEW: knowledge base — sending the kind and the reference the person will
// TEST_OVERVIEW: read; a kind the contract does not name is refused before the server
// TEST_OVERVIEW: is called, and a person with no onboarding to record on is answered
// TEST_OVERVIEW: rather than failed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFirstResultCommand } from "../modules/onboarding/commands/first-result.js";
import type { OnboardingService } from "../modules/onboarding/services/onboarding-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const deps = (svc: Partial<OnboardingService>) => ({
  compatService: {
    check: async () =>
      ok({
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      }),
  },
  configService: {
    getResolved: async () => ok({ server: "http://localhost:4444" }),
    set: vi.fn(),
  },
  createOnboardingService: () => svc as OnboardingService,
});

let stdout = "";
let stderr = "";

async function run(
  svc: Partial<OnboardingService>,
  args: string[],
  code = EXIT_SUCCESS,
) {
  stdout = "";
  stderr = "";
  await expect(
    buildFirstResultCommand(deps(svc)).parseAsync(args, { from: "user" }),
  ).rejects.toThrow(`exit ${code}`);
  return { stdout, stderr };
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dam onboarding first-result", () => {
  // TEST_SCENARIO: the assistant reports a schedule with the reference the person will read; the kind and the reference reach the server as they were given, and the recorded result is printed.
  it("sends the kind and the reference it was given", async () => {
    const recordFirstResult = vi.fn(async () =>
      ok({
        kind: "schedule" as const,
        ref: "agent-dammy/weekly",
        at: "2026-11-12T09:00:00.000Z",
      }),
    );
    const { stdout } = await run({ recordFirstResult }, [
      "schedule",
      "--ref",
      "agent-dammy/weekly",
    ]);
    expect(recordFirstResult).toHaveBeenCalledWith({
      kind: "schedule",
      ref: "agent-dammy/weekly",
    });
    expect(stdout).toContain("schedule (agent-dammy/weekly)");
  });

  // TEST_SCENARIO: a kind the contract does not name is refused before anything is sent, so a typo never rides through as a no-op.
  it("refuses a kind it does not know, without calling the server", async () => {
    const recordFirstResult = vi.fn();
    const { stderr } = await run(
      { recordFirstResult },
      ["sandwich"],
      EXIT_INVALID_INPUT,
    );
    expect(recordFirstResult).not.toHaveBeenCalled();
    expect(stderr).toContain("expected one of");
  });

  // TEST_SCENARIO: a second report is answered with the first result, which the command prints as it came back rather than claiming a new one; and a person with none to record on is told so.
  it("prints what the server answered, including nothing", async () => {
    const first = {
      kind: "artifact" as const,
      ref: null,
      at: "2026-11-12T09:00:00.000Z",
    };
    expect(
      (
        await run({ recordFirstResult: async () => ok(first) }, [
          "artifact",
          "--json",
        ])
      ).stdout,
    ).toBe(`${JSON.stringify(first)}\n`);

    expect(
      (
        await run({ recordFirstResult: async () => ok(null) }, [
          "knowledgeBase",
        ])
      ).stdout,
    ).toContain("Nothing recorded");
  });
});
