// TEST_OVERVIEW: the agent-runtime reports a permission request under the id the client sees, which the lease router wraps with its boot and process, so the id it sends is longer than the harness gave. The recording route must accept what the runtime can hold, and still refuse a frame that is not bounded.
import { describe, expect, it } from "vitest";
import {
  RPC_ID_MAX,
  toolApprovalEndedInputSchema,
  toolApprovalWaitingInputSchema,
} from "api-server-api";

const sessionId = "sess-1";

describe("tool approval route bounds", () => {
  // TEST_SCENARIO: a harness that numbers its requests with a long string leaves the lease router a routed id past the tool call bound. Rejecting it costs the request its row, so the route must accept an id of a held request and refuse only one past its own frame bound.
  it("accepts a routed request id longer than the tool call bound", () => {
    const routedId = `platform-lease-in-${"a".repeat(32)}-12-${"r".repeat(600)}`;

    expect(
      toolApprovalWaitingInputSchema.safeParse({
        sessionId,
        rpcId: routedId,
        toolName: "Run",
        options: [],
      }).success,
    ).toBe(true);
    expect(
      toolApprovalEndedInputSchema.safeParse({ sessionId, rpcId: routedId })
        .success,
    ).toBe(true);
    expect(
      toolApprovalEndedInputSchema.safeParse({
        sessionId,
        rpcId: "r".repeat(RPC_ID_MAX + 1),
      }).success,
    ).toBe(false);
  });
});
