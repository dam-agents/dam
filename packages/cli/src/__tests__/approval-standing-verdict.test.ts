import { describe, expect, it } from "vitest";
import type { ApprovalView } from "api-server-api";
import type { ApprovalService } from "../modules/approval/services/approval-service.js";
import { takesStandingVerdict } from "../modules/approval/commands/standing-verdict.js";

/**
 * TEST_OVERVIEW: Which verdicts an approval takes, as the bare `approve` and
 * `deny` verbs decide it. Some types take only the once verdicts, so the verb
 * has to know before it picks one. The question is answered by reading the row
 * by its id: looking for it in a list would miss any row outside the newest page
 * the server returns, and a satellite job that scrolled off would then be told
 * it takes only a one-time verdict — a statement about a row nobody read. These
 * specs pin both answers and the refusal when the row cannot be read at all.
 */

function service(get: ApprovalService["get"]): ApprovalService {
  return { get } as ApprovalService;
}

const row = (type: ApprovalView["type"]): ApprovalView =>
  ({ id: "a1", type }) as ApprovalView;

describe("whether a standing verdict reaches an approval", () => {
  it("says no for a type that takes only the once verdicts", async () => {
    const takes = await takesStandingVerdict(
      service(async () => ({ ok: true, value: row("satellite_job") })),
      "a1",
    );
    expect(takes).toEqual({ ok: true, standing: false });
  });

  it("says yes for a type that takes a permanent one", async () => {
    const takes = await takesStandingVerdict(
      service(async () => ({ ok: true, value: row("ext_authz") })),
      "a1",
    );
    expect(takes).toEqual({ ok: true, standing: true });
  });

  it("refuses rather than guessing when the row cannot be read", async () => {
    const takes = await takesStandingVerdict(
      service(async () => ({
        ok: false,
        error: { kind: "transport", reason: "boom" },
      })),
      "a1",
    );
    expect(takes.ok).toBe(false);
  });

  it("refuses when there is no such row, instead of downgrading the verdict", async () => {
    const takes = await takesStandingVerdict(
      service(async () => ({ ok: true, value: null })),
      "a1",
    );
    expect(takes.ok).toBe(false);
  });
});
