import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  CASE_STUDY_CONTENT_MAX_CHARS,
  caseStudyInspectionFilterSchema,
  caseStudySubmitInputSchema,
  toCaseStudyInspectionFilter,
  type CaseStudyStatus,
} from "api-server-api";
import type { EditionRecord } from "../../modules/case-studies/domain/editions.js";
import type {
  CaseStudiesRepository,
  UpsertEditionInput,
} from "../../modules/case-studies/infrastructure/case-studies-repository.js";
import { createCaseStudiesService } from "../../modules/case-studies/services/case-studies-service.js";
import { createCaseStudyInspection } from "../../modules/case-studies/services/inspection-service.js";
import { createCaseStudyRetentionSweeper } from "../../modules/case-studies/services/retention-sweeper.js";
import { createCaseStudySubmissions } from "../../modules/case-studies/services/submissions-service.js";

// TEST_OVERVIEW: The case-studies state machine is the consent boundary — a pending edition must be invisible to inspection, a resubmission must fall back to pending, and only the owner's agents may be read or released through the owner service. A regression here leaks an unreleased document across the owner boundary or releases content the owner never saw.

function record(overrides: Partial<EditionRecord> = {}): EditionRecord {
  return {
    id: "ed-1",
    agentId: "agent-a",
    editionWeekStart: "2026-08-17",
    windowStart: "2026-08-11",
    windowEnd: "2026-08-18",
    content: "# Case study",
    harnessImage: "img:1",
    artifactId: null,
    status: "pending",
    deletedAt: null,
    createdAt: new Date("2026-08-17T10:00:00Z"),
    updatedAt: new Date("2026-08-17T10:00:00Z"),
    ...overrides,
  };
}

function fakeRepo(seed: EditionRecord[] = []): CaseStudiesRepository & {
  rows: EditionRecord[];
  upserts: UpsertEditionInput[];
  purges: { createdBefore: Date; tombstonedBefore: Date }[];
} {
  const rows = [...seed];
  const upserts: UpsertEditionInput[] = [];
  const purges: { createdBefore: Date; tombstonedBefore: Date }[] = [];
  return {
    rows,
    upserts,
    purges,
    async upsertEdition(input) {
      upserts.push(input);
      const existing = rows.find(
        (r) =>
          r.agentId === input.agentId &&
          r.editionWeekStart === input.editionWeekStart,
      );
      const next = record({
        ...(existing ?? {}),
        ...input,
        id: existing?.id ?? `ed-${rows.length + 1}`,
        status: "pending",
        deletedAt: null,
      });
      if (existing) rows.splice(rows.indexOf(existing), 1, next);
      else rows.push(next);
      return next;
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listByAgents(agentIds) {
      return rows.filter((r) => agentIds.includes(r.agentId));
    },
    async listReleased(filter) {
      return rows.filter(
        (r) =>
          r.status === "released" &&
          (!filter.weekStart || r.editionWeekStart === filter.weekStart) &&
          (!filter.agentId || r.agentId === filter.agentId) &&
          (!filter.since || r.updatedAt >= filter.since),
      );
    },
    async setStatus(id, status: CaseStudyStatus) {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      const next = record({
        ...row,
        status,
        deletedAt: status === "deleted" ? new Date() : null,
      });
      rows.splice(rows.indexOf(row), 1, next);
      return next;
    },
    async purge(createdBefore, tombstonedBefore) {
      purges.push({ createdBefore, tombstonedBefore });
      return 0;
    },
  };
}

const submitInput = {
  content: "# Case study",
  window_start: "2026-08-11",
  window_end: "2026-08-18",
};

describe("case-study submissions", () => {
  // TEST_SCENARIO: The edition's week identity must come from the server clock at submit time, never from agent input — a spoofable week would let one agent overwrite another week's reviewed edition.
  it("stamps the edition's week start from the server clock and lands pending", async () => {
    const repo = fakeRepo();
    const svc = createCaseStudySubmissions({
      repo,
      now: () => new Date("2026-08-17T12:00:00Z"),
    });
    const receipt = await svc.submit("agent-a", submitInput, "img:1");
    expect(receipt.status).toBe("pending");
    expect(receipt.editionWeekStart).toBe("2026-08-17");
    expect(repo.upserts[0]).toMatchObject({
      agentId: "agent-a",
      editionWeekStart: "2026-08-17",
      harnessImage: "img:1",
      artifactId: null,
    });
  });

  // TEST_SCENARIO: A released edition resubmitted in the same week must fall back to pending — new content has never been reviewed, so it must not stay externally visible under the old release.
  it("resubmission within the week replaces content and resets to pending", async () => {
    const repo = fakeRepo([record({ status: "released" })]);
    const svc = createCaseStudySubmissions({
      repo,
      now: () => new Date("2026-08-20T12:00:00Z"),
    });
    await svc.submit(
      "agent-a",
      { ...submitInput, content: "# Revised" },
      "img:2",
    );
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      status: "pending",
      content: "# Revised",
      harnessImage: "img:2",
    });
  });

  // TEST_SCENARIO: Weeks do not nest in calendar years — 1 Jan 2027 (a Friday) belongs to the week that started Mon 28 Dec 2026. Stamping it under January would split one week's edition across two identities and let a second submission land beside the first instead of replacing it.
  it("stamps a year-boundary week under the Monday it started on", async () => {
    const repo = fakeRepo();
    const svc = createCaseStudySubmissions({
      repo,
      now: () => new Date("2027-01-01T12:00:00Z"),
    });
    const receipt = await svc.submit("agent-a", submitInput, null);
    expect(receipt.editionWeekStart).toBe("2026-12-28");
  });

  // TEST_SCENARIO: The size cap is the storage guard against an agent dumping arbitrary bulk into Postgres through this tool. It is enforced once, on the content field of the submit schema, because the MCP tool registers `caseStudySubmitInputSchema.shape` — a field-level cap is the only kind that survives `.shape` and reaches an agent's call.
  it("refuses content over the size cap at the schema", () => {
    const oversize = caseStudySubmitInputSchema.safeParse({
      ...submitInput,
      content: "x".repeat(CASE_STUDY_CONTENT_MAX_CHARS + 1),
    });
    expect(oversize.success).toBe(false);
    const atCap = caseStudySubmitInputSchema.safeParse({
      ...submitInput,
      content: "x".repeat(CASE_STUDY_CONTENT_MAX_CHARS),
    });
    expect(atCap.success).toBe(true);
  });

  // TEST_SCENARIO: An inverted window is agent confusion, not a valid edition; rejecting it early keeps the stored metadata trustworthy for #3287.
  it("refuses a window whose start is after its end", async () => {
    const svc = createCaseStudySubmissions({
      repo: fakeRepo(),
      now: () => new Date("2026-08-17T12:00:00Z"),
    });
    await expect(
      svc.submit(
        "agent-a",
        { ...submitInput, window_start: "2026-08-19" },
        null,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("case-study owner service", () => {
  const deps = (repo: CaseStudiesRepository) => ({
    repo,
    owner: "user-1",
    listOwnedAgentIds: async () => ["agent-a"],
  });

  // TEST_SCENARIO: The owner list must be scoped by the owned-agent allowlist — returning other owners' rows here would leak pending documents across the owner boundary.
  it("lists only the owner's agents' editions", async () => {
    const repo = fakeRepo([
      record(),
      record({ id: "ed-2", agentId: "agent-foreign" }),
    ]);
    const svc = createCaseStudiesService(deps(repo));
    const editions = await svc.list();
    expect(editions.map((e) => e.id)).toEqual(["ed-1"]);
  });

  // TEST_SCENARIO: A foreign edition id must read as NOT_FOUND, not FORBIDDEN — existence itself is information about another owner's agent.
  it("refuses a foreign edition as not found", async () => {
    const repo = fakeRepo([record({ id: "ed-2", agentId: "agent-foreign" })]);
    const svc = createCaseStudiesService(deps(repo));
    await expect(svc.get("ed-2")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // TEST_SCENARIO: Release is the consent event — it must flip exactly pending→released, stay idempotent on released, and refuse states where releasing would resurrect hidden or deleted content.
  it("releases a pending edition, idempotently accepts a released one, refuses the rest", async () => {
    const repo = fakeRepo([
      record(),
      record({
        id: "ed-2",
        agentId: "agent-a",
        editionWeekStart: "2026-08-10",
        status: "hidden",
      }),
    ]);
    const svc = createCaseStudiesService(deps(repo));
    const released = await svc.release("ed-1");
    expect(released.status).toBe("released");
    const again = await svc.release("ed-1");
    expect(again.status).toBe("released");
    await expect(svc.release("ed-2")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await svc.release("ed-1")) instanceof TRPCError).toBe(false);
  });
});

describe("case-study inspection", () => {
  // TEST_SCENARIO: Inspection is the cross-owner read surface — a pending, hidden, or deleted edition appearing here is exactly the leak the pending state exists to prevent.
  it("serves released editions only", async () => {
    const repo = fakeRepo([
      record(),
      record({ id: "ed-2", agentId: "agent-b", status: "released" }),
      record({ id: "ed-3", agentId: "agent-c", status: "deleted" }),
    ]);
    const svc = createCaseStudyInspection({ repo });
    const listed = await svc.list({});
    expect(listed.map((e) => e.id)).toEqual(["ed-2"]);
    expect(await svc.get("ed-1")).toBeNull();
    expect((await svc.get("ed-2"))?.content).toBe("# Case study");
  });

  // TEST_SCENARIO: The list result is metadata for enumeration — shipping content on every row would make the processing corpus read O(fleet) and leak document bodies into places that only asked for an index.
  /**
   * TEST_SCENARIO: Both inspector read surfaces parse the week filter through
   * this one schema, and the week it yields is fed straight to date arithmetic.
   * A pattern-only check passes strings that are shaped like dates but are not
   * dates: an impossible one crashes that arithmetic (a 500 where a 400 belongs)
   * and an overflowing one silently resolves to the wrong week. Validating by
   * construction is what makes a rejected filter a client error rather than a
   * server fault or a quietly wrong answer.
   */
  it("refuses a week filter that is shaped like a date but is not one", () => {
    for (const week_of of ["2026-13-45", "2026-02-30", "2026-02-29"]) {
      expect(
        caseStudyInspectionFilterSchema.safeParse({ week_of }).success,
      ).toBe(false);
    }
    const parsed = caseStudyInspectionFilterSchema.safeParse({
      week_of: "2026-09-01",
    });
    expect(parsed.success).toBe(true);
    expect(
      toCaseStudyInspectionFilter(parsed.data!).weekOf?.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  it("list carries sizes, never content", async () => {
    const repo = fakeRepo([record({ status: "released" })]);
    const svc = createCaseStudyInspection({ repo });
    const [summary] = await svc.list({});
    expect(summary).not.toHaveProperty("content");
    expect(summary?.contentChars).toBe("# Case study".length);
  });
});

describe("case-study retention sweeper", () => {
  // TEST_SCENARIO: Retention math off by a unit silently erases live editions or keeps tombstones forever; the cutoffs must derive from the injected clock and the configured windows exactly.
  it("purges with cutoffs derived from retention and grace windows", async () => {
    const repo = fakeRepo();
    const sweeper = createCaseStudyRetentionSweeper({
      repo,
      retentionDays: 365,
      graceDays: 30,
      now: () => new Date("2026-08-17T00:00:00Z"),
    });
    await sweeper.tick();
    expect(repo.purges[0]?.createdBefore.toISOString()).toBe(
      "2025-08-17T00:00:00.000Z",
    );
    expect(repo.purges[0]?.tombstonedBefore.toISOString()).toBe(
      "2026-07-18T00:00:00.000Z",
    );
  });
});
