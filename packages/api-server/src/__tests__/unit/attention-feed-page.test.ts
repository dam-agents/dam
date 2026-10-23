// TEST_OVERVIEW: "All sessions" pages the owner's attention record by (activity time, session id). A page asks the store for one row past its limit, sends only the page, and names the next page by its last row, or nothing when the record ended; a device key bound to one agent cannot read the owner's whole record. The session id breaks ties so two rows sharing a time never repeat or vanish between pages.
import { describe, expect, it, vi } from "vitest";
import {
  ATTENTION_PAGE_LIMIT,
  type ApiContext,
  type AttentionListCursor,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";

import type { AttentionRecordRow } from "../../modules/attention/domain/types.js";
import type { AttentionRepository } from "../../modules/attention/infrastructure/attention-repository.js";
import { createAttentionService } from "../../modules/attention/services/attention-service.js";

const row = (
  sessionId: string,
  activityAt: Date | null,
  createdAt = new Date("2026-10-01T10:00:00Z"),
): AttentionRecordRow => ({
  agentId: "agent-a",
  sessionId,
  ownerSub: "owner-1",
  mode: "chat",
  type: "regular",
  title: `title ${sessionId}`,
  scheduleId: null,
  threadTs: null,
  harness: null,
  createdAt,
  activityAt,
  seenAt: null,
  working: false,
});

function service(ownerSub = "owner-1") {
  const listForOwnerPage = vi.fn(
    async (
      _owner: string,
      _opts: { after?: AttentionListCursor | undefined; limit: number },
    ) => [] as AttentionRecordRow[],
  );
  const repo = { listForOwnerPage } as unknown as AttentionRepository;
  return {
    listForOwnerPage,
    attention: createAttentionService({
      repo,
      ownerSub,
      ownsApproval: async () => false,
      ownsAgent: async () => false,
      defaultModelNotices: async () => [],
      outageAlerts: async () => [],
      log: () => {},
    }),
  };
}

describe("attention.listForOwnerPage service", () => {
  // TEST_SCENARIO: a page of n rows is read as n + 1 so the reader learns another page exists, and the extra row stays out of the answer.
  it("reads one row past the page and sends only the page", async () => {
    const { attention, listForOwnerPage } = service();
    const rows = [row("s3", null), row("s2", null), row("s1", null)];
    listForOwnerPage.mockResolvedValueOnce(rows);
    const page = await attention.listForOwnerPage({ limit: 2 });
    expect(page.items.map((item) => item.sessionId)).toEqual(["s3", "s2"]);
    expect(listForOwnerPage.mock.calls[0]?.[0]).toBe("owner-1");
    expect(listForOwnerPage.mock.calls[0]?.[1].limit).toBe(3);
  });

  // TEST_SCENARIO: the next page starts at the last row's activity time and session id; a row that never had one is placed by its creation time, which is the same order the query uses.
  it("names the next page after its last row", async () => {
    const { attention, listForOwnerPage } = service();
    listForOwnerPage.mockResolvedValueOnce([
      row("s2", new Date("2026-10-02T10:00:00Z")),
      row("s1", null),
      row("s0", null),
    ]);
    expect(await attention.listForOwnerPage({ limit: 2 })).toMatchObject({
      nextCursor: {
        activityAt: "2026-10-01T10:00:00.000Z",
        sessionId: "s1",
      },
    });
  });

  // TEST_SCENARIO: a page shorter than the limit is the end of the record, so no cursor follows it.
  it("ends the record with a short page", async () => {
    const { attention, listForOwnerPage } = service();
    listForOwnerPage.mockResolvedValueOnce([row("s1", null)]);
    expect(await attention.listForOwnerPage({ limit: 2 })).toMatchObject({
      nextCursor: null,
    });
  });

  // TEST_SCENARIO: Sessions that share an activity time still page one row at a time: the cursor names both the time and the session id, so the next page starts after the row just sent rather than after every row with that time.
  it("keeps rows that share a time in one order across pages", async () => {
    const { attention, listForOwnerPage } = service();
    const at = new Date("2026-10-02T10:00:00Z");
    listForOwnerPage.mockResolvedValueOnce([
      row("s3", at),
      row("s2", at),
      row("s1", at),
    ]);
    const first = await attention.listForOwnerPage({ limit: 2 });
    expect(first.items.map((item) => item.sessionId)).toEqual(["s3", "s2"]);
    expect(first.nextCursor).toEqual({
      activityAt: "2026-10-02T10:00:00.000Z",
      sessionId: "s2",
    });

    listForOwnerPage.mockResolvedValueOnce([row("s1", at)]);
    const second = await attention.listForOwnerPage({
      after: first.nextCursor!,
      limit: 2,
    });
    expect(second.items.map((item) => item.sessionId)).toEqual(["s1"]);
    expect(second.nextCursor).toBeNull();
    expect(listForOwnerPage.mock.calls[1]?.[1].after).toEqual(first.nextCursor);
  });

  // TEST_SCENARIO: a later page passes the cursor it was given back to the store, and a caller that names no limit gets the unit "All sessions" adds by a screenful.
  it("passes the cursor through and defaults the limit", async () => {
    const { attention, listForOwnerPage } = service();
    const after = {
      activityAt: "2026-10-02T10:00:00.000Z",
      sessionId: "s2",
    };
    await attention.listForOwnerPage({ after });
    expect(listForOwnerPage.mock.calls[0]?.[1]).toEqual({
      after,
      limit: ATTENTION_PAGE_LIMIT + 1,
    });
  });
});

type User = ApiContext["user"];

function caller(user: User) {
  const attention = {
    listForOwner: vi.fn(async () => ({})),
    listForOwnerPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const ctx = { attention, user } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), attention };
}

const key = (scopes: User["scopes"], agentIds: User["agentIds"]): User => ({
  sub: "owner-1",
  preferredUsername: "test",
  scopes,
  agentIds,
  keyId: "key-1",
});

describe("attention.listForOwnerPage router", () => {
  // TEST_SCENARIO: the record spans every agent its owner has, so a key bound to one agent may not read it; the owner's own key may.
  it("refuses a key bound to one agent and serves a wildcard key", async () => {
    const bound = caller(key(["agents:read"], ["agent-a"]));
    await expect(
      bound.caller.attention.listForOwnerPage({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(bound.attention.listForOwnerPage).not.toHaveBeenCalled();

    const wildcard = caller(key(["agents:read"], "*"));
    await wildcard.caller.attention.listForOwnerPage({});
    expect(wildcard.attention.listForOwnerPage).toHaveBeenCalledWith({});
  });
});
