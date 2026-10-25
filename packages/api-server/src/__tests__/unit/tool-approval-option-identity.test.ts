// TEST_OVERVIEW: a permission request's options carry the ids the harness answers with, so a recorded catalog must never rewrite one. Two ids that differ only after the route's character bound stay two ids: shortened, the reject becomes the allow, and a denial would answer the request with an allow.
import { describe, expect, it } from "vitest";
import {
  permissionOptionKindsOf,
  recordedOptionsOf,
  TOOL_CALL_ID_MAX,
} from "api-server-api";
import type { AcpPermissionOption } from "api-server-api";

import {
  pickOptionId,
  verdictOfOutcome,
} from "../../modules/approvals/infrastructure/wrapper-response-frames.js";
import { createApprovalsService } from "../../modules/approvals/services/approvals-service.js";
import { createDeliverySweeper } from "../../modules/approvals/services/delivery-sweeper.js";
import type { PendingApprovalRow } from "../../modules/approvals/domain/types.js";
import type { ApprovalsRepository } from "../../modules/approvals/infrastructure/approvals-repository.js";

const shared = "x".repeat(TOOL_CALL_ID_MAX);
const aliased = [
  { optionId: shared, kind: "allow_once" },
  { optionId: `${shared}-reject`, kind: "reject_once" },
];

describe("tool approval option identity", () => {
  // TEST_SCENARIO: the harness offers an allow whose id is exactly the route's bound and a reject whose id is that allow's id plus a suffix. Recording only the allow leaves a rejection with nothing to answer, which cancels; recording a shortened reject would answer the refuse with the allow.
  it("keeps distinct ids distinct, and drops the one it cannot record", () => {
    expect(recordedOptionsOf(aliased)).toEqual([
      { optionId: shared, kind: "allow_once" },
    ]);
  });

  // TEST_SCENARIO: the runtime holds the whole request, so the answer's kind is still known for an option the catalog could not keep.
  it("knows the kind of an option under the id the harness gave it", () => {
    const kinds = permissionOptionKindsOf(aliased);

    expect(kinds.get(shared)).toBe("allow_once");
    expect(kinds.get(`${shared}-reject`)).toBe("reject_once");
    expect(kinds.size).toBe(2);
  });

  // TEST_SCENARIO: the wire copy of an answer's id can match a recorded allow, because the route bounds it. The runtime states the kind it accepted, so the record follows the runtime, not the shortened id.
  it("records the kind the runtime reported over a recorded id it matches", () => {
    expect(
      verdictOfOutcome(
        [{ optionId: shared, kind: "allow_once" }],
        { outcome: "selected", optionId: shared, kind: "reject_once" },
        { reportedByRuntime: true },
      ),
    ).toBe("deny_once");
  });

  // TEST_SCENARIO: a chat client's answer reaches the api-server over the relay's websocket, where nothing validates its fields. A kind it writes must not decide the record, or a client could claim a refusal for an allow the harness ran.
  it("ignores a kind the chat client wrote into its own answer", () => {
    expect(
      verdictOfOutcome(
        [{ optionId: shared, kind: "allow_once" }],
        { outcome: "selected", optionId: shared, kind: "reject_once" },
        { reportedByRuntime: false },
      ),
    ).toBe("allow_once");
  });

  // TEST_SCENARIO: before option ids were kept whole, a recorded catalog shortened them, so one id could stand for both an allow and a reject. Those rows survive the upgrade, and Home and the delivery sweeper both answer from them: a denial must cancel rather than send an id the harness may read as the allow.
  it("cancels a denial whose reject id a legacy catalog also records as an allow", () => {
    const legacy = [
      { optionId: shared, kind: "allow_once" as const },
      {
        optionId: `${shared}-reject`.slice(0, TOOL_CALL_ID_MAX),
        kind: "reject_once" as const,
      },
    ];

    expect(pickOptionId(legacy, "deny_once")).toBeNull();
    expect(pickOptionId(legacy, "allow_once")).toBeNull();
    expect(pickOptionId(legacy, "allow_once", { idsWhole: true })).toBe(shared);
  });

  // TEST_SCENARIO: the old mapper shortened ids and then kept only sixteen options, so the allow the shortened reject collides with can be the one it drops. Absence of that allow from the stored catalog proves nothing, and both Home and the delivery sweeper answer from it: a reject at the old character bound is never sent from a catalog that cannot prove its ids whole.
  it("cancels a legacy denial whose colliding allow fell outside the count cap", () => {
    const seventeen = [
      ...Array.from({ length: 15 }, (_, n) => ({
        optionId: `yes${n}`,
        kind: "allow_once" as const,
      })),
      { optionId: `${shared}-reject`, kind: "reject_once" as const },
      { optionId: shared, kind: "allow_once" as const },
    ];
    const legacyCatalog = legacyRecordedOptionsOf(seventeen);

    expect(legacyCatalog).toHaveLength(16);
    expect(
      legacyCatalog.some(
        (o) => o.kind === "allow_once" && o.optionId === shared,
      ),
    ).toBe(false);
    expect(legacyCatalog.filter((o) => o.optionId === shared)).toHaveLength(1);

    expect(pickOptionId(legacyCatalog, "deny_once")).toBeNull();
    expect(pickOptionId(legacyCatalog, "deny_once", { idsWhole: true })).toBe(
      shared,
    );
    expect(pickOptionId(legacyCatalog, "allow_once")).toBe("yes0");
  });

  // TEST_SCENARIO: delivery recovery answers from the same stored catalog as Home, so a legacy row whose reject may be a shortened id must not be retried into the harness as an allow either; it sends a cancellation the harness can always read.
  it("retries a legacy denial as a cancellation, never an ambiguous id", async () => {
    const legacyCatalog = legacyRecordedOptionsOf([
      ...Array.from({ length: 15 }, (_, n) => ({
        optionId: `yes${n}`,
        kind: "allow_once",
      })),
      { optionId: `${shared}-reject`, kind: "reject_once" },
      { optionId: shared, kind: "allow_once" },
    ]);
    const sent: string[] = [];
    const delivered: string[] = [];
    const rows = [
      {
        id: "acpnative:a:s:1",
        type: "acp_native",
        agentId: "a",
        ownerSub: "owner-1",
        sessionId: "s",
        payload: {
          kind: "acp_native",
          toolName: "Run",
          rpcId: 1,
          options: legacyCatalog,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        resolvedAt: new Date(),
        verdict: "deny_once",
        decidedBy: "owner-1",
        status: "resolved",
        deliveredAt: null,
      },
    ] as PendingApprovalRow[];
    const repo = {
      listResolvedUndelivered: async () => rows,
      markDelivered: async (id: string) => {
        delivered.push(id);
      },
      expireOverdue: async () => [],
    } as Partial<ApprovalsRepository> as ApprovalsRepository;
    const sweeper = createDeliverySweeper({
      repo,
      wrapperFrameSender: {
        send: async (_agentId: string, frame: string) => {
          sent.push(frame);
        },
      },
      staleMs: 0,
      batchSize: 50,
    });

    await sweeper.tick();

    expect(sent).toEqual([
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { outcome: { outcome: "cancelled" } },
      }),
    ]);
    expect(delivered).toEqual(["acpnative:a:s:1"]);
  });

  // TEST_SCENARIO: #5468 recorded an allow_once and an allow_always whose ids differed only after the bound, so the stored catalog holds the persistent id once, as a one-time allow. Approve Once must not grant the persistent permission: a legacy row answers only an option it can prove was not shortened.
  it("never turns a legacy Approve Once into the persistent permission", () => {
    const once = `${"g".repeat(TOOL_CALL_ID_MAX)}-once`;
    const legacyCatalog = legacyRecordedOptionsOf([
      { optionId: once, kind: "allow_once" },
      { optionId: "g".repeat(TOOL_CALL_ID_MAX), kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
    ]);

    expect(
      legacyCatalog.filter((o) => o.kind?.startsWith("allow")),
    ).toHaveLength(2);
    expect(pickOptionId(legacyCatalog, "allow_once")).toBeNull();
    expect(pickOptionId(legacyCatalog, "allow")).toBeNull();
    expect(pickOptionId(legacyCatalog, "deny_once")).toBe("no");
  });

  // TEST_SCENARIO: ordinary approvals must keep working on a legacy row: an option whose id is shorter than the old bound was provably left alone, so it stays selectable and the owner's permission still reaches the harness.
  it("still answers a legacy row's intact options", () => {
    const legacyCatalog = legacyRecordedOptionsOf([
      { optionId: "yes", kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
    ]);

    expect(pickOptionId(legacyCatalog, "allow_once")).toBe("yes");
    expect(pickOptionId(legacyCatalog, "allow")).toBe("always");
    expect(pickOptionId(legacyCatalog, "deny_once")).toBe("no");
  });

  // TEST_SCENARIO: a current runtime drops a one-time choice whose id exceeded the bound, so the recorded row keeps only the persistent choice and a reject, with every retained id whole. A whole id says which option it is, not how far it reaches: Allow once must cancel rather than take the persistent permission, through Home and through delivery recovery alike.
  it("never widens a one-time verdict to the persistent permission on a whole catalog", async () => {
    const options = recordedOptionsOf([
      { optionId: "o".repeat(TOOL_CALL_ID_MAX + 1), kind: "allow_once" },
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
    ]);
    expect(options).toEqual([
      { optionId: "always", kind: "allow_always" },
      { optionId: "no", kind: "reject_once" },
    ]);

    expect(pickOptionId(options, "allow_once", { idsWhole: true })).toBeNull();
    expect(pickOptionId(options, "allow", { idsWhole: true })).toBe("always");
    expect(pickOptionId(options, "deny_once", { idsWhole: true })).toBe("no");
    expect(await deliver(options, "allow_once")).toEqual([
      { outcome: "cancelled" },
    ]);
    expect(await sweep(options, "allow_once")).toEqual(["cancelled"]);
  });

  // TEST_SCENARIO: the same rule for the persistent verdict: it never answers a one-time choice, so Approve Always cannot quietly become a single approval.
  it("never narrows the persistent verdict to a one-time choice", async () => {
    const options = recordedOptionsOf([
      { optionId: "yes", kind: "allow_once" },
      { optionId: "no", kind: "reject_once" },
    ]);

    expect(pickOptionId(options, "allow", { idsWhole: true })).toBeNull();
    expect(await deliver(options, "allow")).toEqual([{ outcome: "cancelled" }]);
    expect(await sweep(options, "allow")).toEqual(["cancelled"]);
  });

  // TEST_SCENARIO: the recorder keeps an option's id but not a kind it does not recognize, and keeps an option that states none. No shipped harness states its options that way, and an option whose kind is unknown may grant more than the verdict asks for, so answering it with an approval is guessing. Both verdicts cancel instead.
  it("never answers an option whose kind is missing or unrecognized", async () => {
    const options = legacyRecordedOptionsOf([
      { optionId: "persist", kind: "persist" },
      { optionId: "opaque" },
      { optionId: "no", kind: "reject_once" },
    ]);

    expect(pickOptionId(options, "allow_once", { idsWhole: true })).toBeNull();
    expect(pickOptionId(options, "allow", { idsWhole: true })).toBeNull();
    expect(pickOptionId(options, "allow_once")).toBeNull();
    expect(pickOptionId(options, "allow")).toBeNull();
    expect(await deliver(options, "allow_once")).toEqual([
      { outcome: "cancelled" },
    ]);
    expect(await deliver(options, "allow")).toEqual([{ outcome: "cancelled" }]);
    expect(await sweep(options, "allow_once")).toEqual(["cancelled"]);
    expect(await sweep(options, "allow")).toEqual(["cancelled"]);
  });
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: The catalog merged #5468 recorded, kept here as
 * the reproduction of a row that survives the upgrade: ids shortened to the
 * character bound, then the count cap keeping one option of each kind first.
 */
function legacyRecordedOptionsOf(
  raw: { optionId: string; kind?: string }[],
): AcpPermissionOption[] {
  const kinds = ["allow_once", "allow_always", "reject_once", "reject_always"];
  const all = raw.map(({ optionId, kind }) => ({
    optionId: optionId.slice(0, TOOL_CALL_ID_MAX),
    ...(kinds.includes(kind ?? "") && {
      kind: kind as AcpPermissionOption["kind"],
    }),
  }));
  const firstOfEachKind = kinds.flatMap(
    (kind) => all.find((option) => option.kind === kind) ?? [],
  );
  return [...firstOfEachKind, ...all]
    .filter((option, index, list) => list.indexOf(option) === index)
    .slice(0, 16)
    .sort((left, right) => all.indexOf(left) - all.indexOf(right));
}

interface SentFrame {
  result: { outcome: { outcome: string; optionId?: string } };
}

function wholeRow(
  options: AcpPermissionOption[],
  verdict: "allow_once" | "allow",
): PendingApprovalRow {
  return {
    id: `acpnative:a:s:${verdict}`,
    type: "acp_native",
    agentId: "a",
    ownerSub: "owner-1",
    sessionId: "s",
    payload: {
      kind: "acp_native",
      toolName: "Run",
      rpcId: 1,
      options,
      optionsWhole: true,
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: new Date(),
    verdict,
    decidedBy: "owner-1",
    status: "resolved",
    deliveredAt: null,
  } as PendingApprovalRow;
}

function repoFor(row: PendingApprovalRow): ApprovalsRepository {
  return {
    getPending: async (id: string) =>
      id === row.id ? { ...row, status: "pending", verdict: null } : null,
    resolvePending: async (id: string) => id === row.id,
    listResolvedUndelivered: async () => [row],
    markDelivered: async () => {},
    expireOverdue: async () => [],
    insertSettled: async () => true,
  } as Partial<ApprovalsRepository> as ApprovalsRepository;
}

async function deliver(
  options: AcpPermissionOption[],
  verdict: "allow_once" | "allow",
): Promise<SentFrame["result"]["outcome"][]> {
  const sent: string[] = [];
  const service = createApprovalsService({
    repo: repoFor(wholeRow(options, verdict)),
    egressRuleWriter: {
      insert: async (input) => ({
        kind: "inserted",
        row: { id: input.id, verdict: input.verdict, source: "inbox" },
      }),
    },
    wrapperFrameSender: {
      send: async (_agentId: string, frame: string) => {
        sent.push(frame);
      },
    },
    isAgentOwnedBy: async () => true,
    ownerSub: "owner-1",
    actor: "owner-1",
    actorEmail: null,
    agentBinding: "*",
  });

  const outcome =
    verdict === "allow_once" ? service.approveOnce : service.approvePermanent;
  await outcome(wholeRow(options, verdict).id);
  return sent.map((frame) => (JSON.parse(frame) as SentFrame).result.outcome);
}

async function sweep(
  options: AcpPermissionOption[],
  verdict: "allow_once" | "allow",
): Promise<string[]> {
  const sent: string[] = [];
  const row = wholeRow(options, verdict);
  const sweeper = createDeliverySweeper({
    repo: repoFor(row),
    wrapperFrameSender: {
      send: async (_agentId: string, frame: string) => {
        sent.push(frame);
      },
    },
    staleMs: 0,
    batchSize: 50,
  });

  await sweeper.tick();
  return sent.map(
    (frame) => (JSON.parse(frame) as SentFrame).result.outcome.outcome,
  );
}
