// TEST_OVERVIEW: while a Kit Update is pending, the initialization chat opened at or after its start is the update's session; the onboarding chat before it and any chat once the update ends are not.
import { isKitUpdateSession, SessionType } from "api-server-api";
import { describe, expect, test } from "vitest";

const PENDING = {
  targetCommit: "b".repeat(40),
  startedAt: "2026-10-20T10:00:00.000Z",
};

const session = (createdAt: string) => ({
  initialization: true,
  type: SessionType.Regular,
  createdAt,
});

describe("isKitUpdateSession", () => {
  test("marks the initialization chat the pending update opened", () => {
    expect(
      isKitUpdateSession(session("2026-10-20T10:00:02.000Z"), PENDING),
    ).toBe(true);
  });

  test("leaves the onboarding chat from before the update unmarked", () => {
    expect(
      isKitUpdateSession(session("2026-09-01T08:00:00.000Z"), PENDING),
    ).toBe(false);
  });

  test("drops the mark once the update is no longer pending", () => {
    expect(isKitUpdateSession(session("2026-10-20T10:00:02.000Z"), null)).toBe(
      false,
    );
  });
});
