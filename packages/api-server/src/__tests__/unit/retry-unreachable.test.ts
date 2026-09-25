/**
 * TEST_OVERVIEW: A boot step that fails because Postgres or the object store is
 * not reachable yet is run again until it succeeds or the budget runs out. Any
 * other failure is thrown at once, so a real error still stops the boot.
 */
import { describe, expect, it } from "vitest";
import {
  isUnreachable,
  retryWhileUnreachable,
} from "../../core/retry-unreachable.js";

const connError = (code: string) =>
  Object.assign(new Error(`read ${code}`), { code });

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("isUnreachable", () => {
  it("matches a connection error by its code, also as a cause", () => {
    expect(isUnreachable(connError("ECONNRESET"))).toBe(true);
    expect(
      isUnreachable(new Error("wrapped", { cause: connError("ECONNREFUSED") })),
    ).toBe(true);
    expect(isUnreachable(connError("57P03"))).toBe(true);
  });

  it("does not match other errors", () => {
    expect(isUnreachable(connError("28P01"))).toBe(false);
    expect(isUnreachable(new Error("boom"))).toBe(false);
    expect(isUnreachable("ECONNRESET")).toBe(false);
  });
});

describe("retryWhileUnreachable", () => {
  /**
   * TEST_SCENARIO: The service resets the first two connections while it
   * starts, then answers. The step's result comes back after two retries.
   */
  it("retries a connection error until the step succeeds", async () => {
    const clock = fakeClock();
    const logs: string[] = [];
    let calls = 0;
    const result = await retryWhileUnreachable(
      "migrations",
      async () => {
        calls++;
        if (calls < 3) throw connError("ECONNRESET");
        return "done";
      },
      { budgetMs: 10_000, delayMs: 1_000, log: (m) => logs.push(m), ...clock },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("migrations");
  });

  /**
   * TEST_SCENARIO: A failure that is not about reaching the service, such as a
   * bad password, is thrown on the first attempt.
   */
  it("throws any other error at once", async () => {
    let calls = 0;
    const bad = connError("28P01");
    await expect(
      retryWhileUnreachable(
        "migrations",
        async () => {
          calls++;
          throw bad;
        },
        { budgetMs: 10_000, delayMs: 1_000, log: () => {}, ...fakeClock() },
      ),
    ).rejects.toBe(bad);
    expect(calls).toBe(1);
  });

  /**
   * TEST_SCENARIO: The service never comes up. The last connection error is
   * thrown once another wait would pass the budget.
   */
  it("gives up with the last error when the budget runs out", async () => {
    let calls = 0;
    await expect(
      retryWhileUnreachable(
        "object storage",
        async () => {
          calls++;
          throw connError("ECONNREFUSED");
        },
        { budgetMs: 5_000, delayMs: 2_000, log: () => {}, ...fakeClock() },
      ),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(calls).toBe(3);
  });
});
