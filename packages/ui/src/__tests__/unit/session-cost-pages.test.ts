import { describe, expect, it } from "vitest";

import { sessionCostPages } from "../../modules/metrics/lib/session-cost-pages.js";

const session = (
  sessionId: string,
  createdAt: string,
  updatedAt: string | null = "2026-10-08T00:00:00Z",
) => ({ sessionId, createdAt, updatedAt });

describe("sessionCostPages", () => {
  it("splits the list into pages bounded by each page's earliest session", () => {
    const pages = sessionCostPages(
      [
        session("s3", "2026-10-07T12:00:00Z"),
        session("s1", "2026-10-01T10:00:00Z"),
        session("s2", "2026-09-01T00:00:00Z"),
      ],
      2,
    );
    expect(pages).toEqual([
      { sessionIds: ["s1", "s3"], from: "2026-10-01T09:55:00.000Z" },
      { sessionIds: ["s2"], from: "2026-08-31T23:55:00.000Z" },
    ]);
  });

  it("leaves a page unbounded when a session's createdAt is not its start", () => {
    const harnessOnly = session(
      "s2",
      "2026-10-07T12:00:00Z",
      "2026-10-07T12:00:00Z",
    );
    const openedStub = session("s3", "2026-10-08T07:00:00Z", null);
    for (const unknown of [harnessOnly, openedStub, session("s4", "")]) {
      const [page] = sessionCostPages([
        session("s1", "2026-10-01T10:00:00Z"),
        unknown,
      ]);
      expect(page).toEqual({ sessionIds: ["s1", unknown.sessionId] });
    }
  });
});
