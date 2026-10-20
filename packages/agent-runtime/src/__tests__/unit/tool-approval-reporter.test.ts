// TEST_OVERVIEW: the agent-runtime tells the api-server about a tool approval nobody can answer, and how it ended. The report carries what the api-server records for Home (tool, arguments, options), goes out in the order things happened, survives a failed call by retrying, and one stalled call never holds another request's reports.
import { describe, expect, it, vi } from "vitest";

import type { HarnessClient } from "../../modules/runtime-channel/harness-client.js";
import { createToolApprovalReporter } from "../../modules/runtime-channel/tool-approval-reporter.js";

function fakeClient(failFirst = 0): {
  client: HarnessClient;
  sent: [string, unknown][];
} {
  const sent: [string, unknown][] = [];
  let failures = failFirst;
  const call = (name: string) => ({
    mutate: async (input: unknown) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("api-server unreachable");
      }
      sent.push([name, input]);
    },
  });
  const client = {
    approvals: { v1: { waiting: call("waiting"), ended: call("ended") } },
  } as unknown as HarnessClient;
  return { client, sent };
}

const request = JSON.stringify({
  jsonrpc: "2.0",
  id: 7,
  method: "session/request_permission",
  params: {
    sessionId: "s-1",
    toolCall: {
      toolCallId: "tc-7",
      title: "Write /tmp/a",
      rawInput: { path: "/tmp/a" },
    },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ],
  },
});

describe("tool approval reporter", () => {
  // TEST_SCENARIO: Home renders the request from the report alone, so the report must carry the tool's title, its call id and arguments, and the options with their kinds; the answer that follows carries the chosen option, so the row records the verdict.
  it("reports a waiting request, then its answer, in order", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });

    reporter.waiting("platform-lease-in-1-7", "s-1", request);
    reporter.answered("platform-lease-in-1-7", "s-1", {
      outcome: { outcome: "selected", optionId: "allow" },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent).toEqual([
      [
        "waiting",
        {
          sessionId: "s-1",
          rpcId: "platform-lease-in-1-7",
          toolName: "Write /tmp/a",
          toolCallId: "tc-7",
          args: { path: "/tmp/a" },
          options: [
            { optionId: "allow", kind: "allow_once" },
            { optionId: "no", kind: "reject_once" },
          ],
        },
      ],
      [
        "ended",
        {
          sessionId: "s-1",
          rpcId: "platform-lease-in-1-7",
          outcome: { outcome: "selected", optionId: "allow" },
        },
      ],
    ]);
  });

  // TEST_SCENARIO: a request the runtime dropped unanswered ends with no outcome, which the api-server reads as expired; an api-server that was briefly unreachable still gets both reports, in order.
  it("retries a failed report and ends a dropped request without an outcome", async () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient(1);
    const reporter = createToolApprovalReporter({ client, log: () => {} });

    reporter.waiting(7, "s-1", request);
    reporter.abandoned(7, "s-1");
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();

    expect(sent.map(([name]) => name)).toEqual(["waiting", "ended"]);
    expect(sent[1]?.[1]).toEqual({ sessionId: "s-1", rpcId: 7 });
  });

  // TEST_SCENARIO: the harness controls the frame, so options that are not an array, or hold null or a non-object, must neither throw inside the runtime's event handler nor reach the report.
  it("reports a request whose options are malformed without them", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });
    const withOptions = (options: unknown) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "session/request_permission",
        params: { sessionId: "s-1", toolCall: { title: "Run" }, options },
      });

    expect(() => {
      reporter.waiting(9, "s-1", withOptions("allow"));
      reporter.waiting(10, "s-1", withOptions([null, 3, { optionId: "ok" }]));
    }).not.toThrow();
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(
      sent.map(([, input]) => (input as { options: unknown }).options),
    ).toEqual([[], [{ optionId: "ok", kind: undefined }]]);
  });

  // TEST_SCENARIO: the harness writes the frame, so a tool call id or an option list can exceed what the recording route accepts. The report must be shaped to that route's bounds instead of being rejected, and both row writers must name the tool the same way, or the second cannot join the first's row.
  it("shapes an oversized frame to the route's bounds and the shared mapping", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });
    const options = Array.from({ length: 20 }, (_, n) => ({
      optionId: `opt-${n}`,
      kind: "allow_once",
    }));

    reporter.held(12, "s-1", "{}");
    reporter.waiting(
      12,
      "s-1",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "session/request_permission",
        params: {
          sessionId: "s-1",
          toolCall: { toolCallId: "c".repeat(600), title: "" },
          options,
        },
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const report = sent[0]![1] as {
      toolName: string;
      toolCallId: string;
      options: unknown[];
    };
    expect(report.toolName).toBe("tool call");
    expect(report.toolCallId).toHaveLength(512);
    expect(report.options).toHaveLength(16);
  });

  // TEST_SCENARIO: an agent request that is not a permission prompt has nothing to approve, so neither it nor its end is reported.
  it("reports nothing for an agent request that is not a permission prompt", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });

    reporter.held(
      8,
      "s-1",
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file" }),
    );
    reporter.waiting(
      8,
      "s-1",
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file" }),
    );
    reporter.abandoned(8, "s-1");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toEqual([]);
  });

  // TEST_SCENARIO: the api-server accepts a report and then never answers it, as a hung database write does. Every request shares the process, so the stalled one must not hold the waiting report of a request in another session: that request would expire unseen. Its own end report must go out too, once the attempts run out.
  it("keeps reporting other requests while one report stalls", async () => {
    vi.useFakeTimers();
    const sent: [string, unknown][] = [];
    let stalled = true;
    const client = {
      approvals: {
        v1: {
          waiting: {
            mutate: (input: { sessionId: string }) => {
              if (stalled && input.sessionId === "s-1") {
                return new Promise(() => {});
              }
              sent.push(["waiting", input]);
              return Promise.resolve();
            },
          },
          ended: {
            mutate: async (input: unknown) => {
              sent.push(["ended", input]);
            },
          },
        },
      },
    } as unknown as HarnessClient;
    const reporter = createToolApprovalReporter({ client, log: () => {} });
    const approval = (id: number, sessionId: string) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: { sessionId, toolCall: { title: "Run" }, options: [] },
      });

    reporter.held(1, "s-1", approval(1, "s-1"));
    reporter.waiting(1, "s-1", approval(1, "s-1"));
    reporter.held(2, "s-2", approval(2, "s-2"));
    reporter.waiting(2, "s-2", approval(2, "s-2"));
    await vi.waitFor(() =>
      expect(sent).toEqual([
        ["waiting", expect.objectContaining({ sessionId: "s-2" })],
      ]),
    );

    stalled = false;
    reporter.abandoned(1, "s-1");
    await vi.advanceTimersByTimeAsync(30_000);
    vi.useRealTimers();

    expect(sent).toEqual([
      ["waiting", expect.objectContaining({ sessionId: "s-2" })],
      ["waiting", expect.objectContaining({ sessionId: "s-1" })],
      ["ended", { sessionId: "s-1", rpcId: 1 }],
    ]);
  });
});
