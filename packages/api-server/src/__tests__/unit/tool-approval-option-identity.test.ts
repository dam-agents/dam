// TEST_OVERVIEW: a permission request's options carry the ids the harness answers with, so a recorded catalog must never rewrite one. Two ids that differ only after the route's character bound stay two ids: shortened, the reject becomes the allow, and a denial would answer the request with an allow.
import { describe, expect, it } from "vitest";
import {
  permissionOptionKindsOf,
  recordedOptionsOf,
  TOOL_CALL_ID_MAX,
} from "api-server-api";

import {
  pickOptionId,
  verdictOfOutcome,
} from "../../modules/approvals/infrastructure/wrapper-response-frames.js";

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
    expect(pickOptionId(legacy, "allow_once")).toBe(shared);
  });
});
