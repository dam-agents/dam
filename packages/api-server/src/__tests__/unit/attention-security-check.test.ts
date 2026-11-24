// TEST_OVERVIEW: Home lists the security check's alert beside the attention record. The alert opens the newest Session the check's Schedule opened before the report, or no Session when the list holds none. A dismissal names one report: it is accepted only for the report that stands, and it is dropped once that report is gone, so the next report is told again. A failing read leaves the feed and the dismissals as they were.
import type { SecurityCheckReport } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import type {
  AttentionRecordRow,
  DismissalRow,
} from "../../modules/attention/domain/types.js";
import type { AttentionRepository } from "../../modules/attention/infrastructure/attention-repository.js";
import { createAttentionService } from "../../modules/attention/services/attention-service.js";

const REPORTED_AT = "2026-11-17T09:00:00.000Z";

const report: SecurityCheckReport = {
  agentId: "agent-ada",
  scheduleId: "schedule-1",
  problems: ["bot: shared sign-in"],
  reportedAt: REPORTED_AT,
};

const session = (
  sessionId: string,
  scheduleId: string | null,
  createdAt: string,
  agentId = "agent-ada",
): AttentionRecordRow => ({
  agentId,
  sessionId,
  ownerSub: "owner-1",
  mode: "chat",
  type: "scheduled",
  title: "Security check",
  scheduleId,
  threadTs: null,
  harness: null,
  createdAt: new Date(createdAt),
  activityAt: null,
  seenAt: null,
  working: false,
});

const dismissal = (itemId: string): DismissalRow => ({
  kind: "security-check",
  itemId,
  dismissedAt: new Date("2026-11-17T10:00:00Z"),
});

function service(opts: {
  records?: AttentionRecordRow[];
  dismissals?: DismissalRow[];
  securityCheck: () => Promise<SecurityCheckReport | null>;
}) {
  const deleteDismissals = vi.fn(async () => {});
  const setDismissals = vi.fn(async () => {});
  const repo = {
    listForOwner: async () => opts.records ?? [],
    listDismissals: async () => opts.dismissals ?? [],
    deleteDismissals,
    setDismissals,
  } as unknown as AttentionRepository;
  return {
    deleteDismissals,
    setDismissals,
    attention: createAttentionService({
      repo,
      ownerSub: "owner-1",
      ownsApproval: async () => false,
      ownsAgent: async () => true,
      defaultModelNotices: async () => [],
      outageAlerts: async () => [],
      costReviews: async () => [],
      securityCheck: opts.securityCheck,
      log: () => {},
    }),
  };
}

describe("attention.listForOwner with a security check alert", () => {
  // TEST_SCENARIO: the check's Schedule opened two Sessions before the report and a third after it, which has not reported; another Schedule and another Agent have their own. The alert opens the newest Session of the check's Schedule on its Agent from before the report.
  it("opens the newest session the check's schedule opened before the report", async () => {
    const { attention } = service({
      records: [
        session("s-old", "schedule-1", "2026-11-10T09:00:00Z"),
        session("s-new", "schedule-1", "2026-11-17T08:55:00Z"),
        session("s-next-run", "schedule-1", "2026-11-24T08:55:00Z"),
        session("s-other", "schedule-2", "2026-11-17T08:59:00Z"),
        session("s-chat", null, "2026-11-17T08:59:30Z"),
        session("s-foreign", "schedule-1", "2026-11-17T08:59:45Z", "agent-b"),
      ],
      securityCheck: async () => report,
    });
    expect((await attention.listForOwner()).securityChecks).toEqual([
      {
        id: REPORTED_AT,
        agentId: "agent-ada",
        sessionId: "s-new",
        problems: ["bot: shared sign-in"],
        reportedAt: REPORTED_AT,
      },
    ]);
  });

  // TEST_SCENARIO: the session list no longer holds a Session of the check, so the alert is still told and names no Session.
  it("tells the alert without a session when the list holds none", async () => {
    const { attention } = service({ securityCheck: async () => report });
    expect((await attention.listForOwner()).securityChecks).toMatchObject([
      { sessionId: null },
    ]);
  });

  // TEST_SCENARIO: a dismissal of the report that stands is kept, and one of an earlier report is deleted, so a new report is told again.
  it("drops the dismissal of a report that is gone", async () => {
    const { attention, deleteDismissals } = service({
      dismissals: [
        dismissal(REPORTED_AT),
        dismissal("2026-11-10T09:00:00.000Z"),
      ],
      securityCheck: async () => report,
    });
    const list = await attention.listForOwner();
    expect(list.dismissed.map((d) => d.id)).toEqual([REPORTED_AT]);
    expect(deleteDismissals).toHaveBeenCalledWith("owner-1", "security-check", [
      "2026-11-10T09:00:00.000Z",
    ]);
  });

  // TEST_SCENARIO: the report cannot be read, so the feed answers without an alert and no dismissal is deleted for a report that only failed to load.
  it("keeps the feed and the dismissals when the report fails", async () => {
    const { attention, deleteDismissals } = service({
      dismissals: [dismissal(REPORTED_AT)],
      securityCheck: async () => {
        throw new Error("database unavailable");
      },
    });
    const list = await attention.listForOwner();
    expect(list.securityChecks).toEqual([]);
    expect(list.dismissed.map((d) => d.id)).toEqual([REPORTED_AT]);
    expect(deleteDismissals).not.toHaveBeenCalled();
  });
});

describe("attention.dismiss with a security check alert", () => {
  // TEST_SCENARIO: only the report that stands can be dismissed, so a made-up id or an earlier report writes nothing.
  it("records a dismissal only for the report that stands", async () => {
    const { attention, setDismissals } = service({
      securityCheck: async () => report,
    });
    await attention.dismiss({
      items: [
        { kind: "security-check", id: REPORTED_AT },
        { kind: "security-check", id: "2026-11-10T09:00:00.000Z" },
      ],
    });
    expect(setDismissals).toHaveBeenCalledWith(
      "owner-1",
      [{ kind: "security-check", itemId: REPORTED_AT }],
      expect.any(Date),
    );
  });
});
