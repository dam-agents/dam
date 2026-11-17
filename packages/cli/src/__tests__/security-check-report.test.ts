// TEST_OVERVIEW: `dam security-check report` sends what the assistant's check
// TEST_OVERVIEW: of the person's setup found: one title per `--problem`, or none
// TEST_OVERVIEW: when the setup is fine, which clears the alert; `--update`
// TEST_OVERVIEW: marks what is left of the same check after a fix. A report the
// TEST_OVERVIEW: contract refuses is stopped before the server is called, and a
// TEST_OVERVIEW: person with no check to report on is answered rather than failed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECURITY_CHECK_PROBLEM_MAX_LENGTH } from "api-server-api";

import { buildReportCommand } from "../modules/security-check/commands/report.js";
import type { SecurityCheckService } from "../modules/security-check/services/security-check-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const ok = <T>(value: T) => ({ ok: true as const, value });

const deps = (svc: Partial<SecurityCheckService>) => ({
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
  createSecurityCheckService: () => svc as SecurityCheckService,
});

const reported = (problems: string[]) => ({
  agentId: "agent-ada",
  scheduleId: "schedule-1",
  problems,
  reportedAt: "2026-11-17T09:00:00.000Z",
});

let stdout = "";
let stderr = "";

async function run(
  svc: Partial<SecurityCheckService>,
  args: string[],
  code = EXIT_SUCCESS,
) {
  stdout = "";
  stderr = "";
  await expect(
    buildReportCommand(deps(svc)).parseAsync(args, { from: "user" }),
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

describe("dam security-check report", () => {
  // TEST_SCENARIO: the check found two problems; each `--problem` reaches the server as one title, in the order given, and the answer says an alert follows.
  it("sends one title for each problem", async () => {
    const report = vi.fn(async (input: { problems: string[] }) =>
      ok(reported(input.problems)),
    );
    const { stdout } = await run({ report }, [
      "--problem",
      "release-bot: your GitHub sign-in is shared with #releases",
      "--problem",
      "ci: full access",
    ]);
    expect(report).toHaveBeenCalledWith({
      problems: [
        "release-bot: your GitHub sign-in is shared with #releases",
        "ci: full access",
      ],
    });
    expect(stdout).toContain("2 problem(s)");
  });

  // TEST_SCENARIO: the check found nothing, so the command sends an empty report, which is what clears an earlier alert.
  it("sends an empty report when nothing was found", async () => {
    const report = vi.fn(async () => ok(reported([])));
    const { stdout } = await run({ report }, []);
    expect(report).toHaveBeenCalledWith({ problems: [] });
    expect(stdout).toContain("The alert is cleared");
  });

  // TEST_SCENARIO: after a fix the assistant reports what is left of the same check, and the command says so to the server; without the flag it sends none.
  it("marks an update of the same check", async () => {
    const report = vi.fn(async (input: { problems: string[] }) =>
      ok(reported(input.problems)),
    );
    await run({ report }, ["--problem", "ci: full access", "--update"]);
    expect(report).toHaveBeenCalledWith({
      problems: ["ci: full access"],
      update: true,
    });
  });

  // TEST_SCENARIO: a title longer than the alert can show is refused before anything is sent, so the person never gets a cut-off alert.
  it("refuses a title that is too long, without calling the server", async () => {
    const report = vi.fn();
    const { stderr } = await run(
      { report },
      ["--problem", "x".repeat(SECURITY_CHECK_PROBLEM_MAX_LENGTH + 1)],
      EXIT_INVALID_INPUT,
    );
    expect(report).not.toHaveBeenCalled();
    expect(stderr).toContain("invalid report");
  });

  // TEST_SCENARIO: the person has the check turned off, so the server records nothing; the command says so and prints the answer as it came back in JSON.
  it("prints what the server answered, including nothing", async () => {
    expect(
      (await run({ report: async () => ok(null) }, ["--problem", "x"])).stdout,
    ).toContain("Nothing recorded");
    const answer = reported(["x"]);
    expect(
      (
        await run({ report: async () => ok(answer) }, [
          "--problem",
          "x",
          "--json",
        ])
      ).stdout,
    ).toBe(`${JSON.stringify(answer)}\n`);
  });
});
