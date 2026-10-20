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
  // TEST_SCENARIO: Home renders the request from the report alone, so the report must carry the tool's title, its call id and arguments, and the options with their kinds; the answer that follows carries the chosen option and its kind, so the row records the verdict even where its bounded catalog dropped that option.
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
          outcome: {
            outcome: "selected",
            optionId: "allow",
            kind: "allow_once",
          },
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
    await vi.advanceTimersByTimeAsync(2_000);
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
    ).toEqual([[], [{ optionId: "ok" }]]);
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

  // TEST_SCENARIO: the api-server accepts a report and then never answers it, as a hung database write does. Every request shares the process, so the stalled one must not hold the waiting report of a request in another session: that request would expire unseen. The stalled request is answered meanwhile, so its own end report must still go out, and it must stop retrying a report nobody needs. A call that ran out its deadline is aborted, not left to land after the request is over.
  it("keeps reporting other requests while one report stalls", async () => {
    vi.useFakeTimers();
    const sent: [string, unknown][] = [];
    const signals: AbortSignal[] = [];
    let stalled = true;
    const client = {
      approvals: {
        v1: {
          waiting: {
            mutate: (
              input: { sessionId: string },
              opts?: { signal?: AbortSignal },
            ) => {
              if (stalled && input.sessionId === "s-1") {
                if (opts?.signal) signals.push(opts.signal);
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
      ["ended", { sessionId: "s-1", rpcId: 1 }],
    ]);
    expect(signals).not.toHaveLength(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  // TEST_SCENARIO: an api-server restart outlasts any fixed attempt budget, and a request that stayed invisible through it is the defect this report exists to fix. The report must keep trying while the request is still held, and must stop as soon as it ends.
  it("keeps reporting a still-held request after the api-server comes back", async () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient(6);
    const reporter = createToolApprovalReporter({ client, log: () => {} });

    reporter.held(7, "s-1", request);
    reporter.waiting(7, "s-1", request);
    await vi.advanceTimersByTimeAsync(120_000);
    vi.useRealTimers();

    expect(sent).toEqual([
      ["waiting", expect.objectContaining({ rpcId: 7, sessionId: "s-1" })],
    ]);
  });

  // TEST_SCENARIO: the request was answered or dropped while its report was still failing, so a further waiting report would describe something that no longer exists; its end report must be the last word.
  it("stops reporting a waiting request once it ends", async () => {
    vi.useFakeTimers();
    const sent: [string, unknown][] = [];
    let waitingCalls = 0;
    const client = {
      approvals: {
        v1: {
          waiting: {
            mutate: () => {
              waitingCalls += 1;
              return Promise.reject(new Error("api-server unreachable"));
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

    reporter.held(7, "s-1", request);
    reporter.waiting(7, "s-1", request);
    await vi.advanceTimersByTimeAsync(20_000);
    const before = waitingCalls;
    reporter.abandoned(7, "s-1");
    await vi.advanceTimersByTimeAsync(120_000);
    vi.useRealTimers();

    expect(waitingCalls).toBe(before);
    expect(sent).toEqual([["ended", { sessionId: "s-1", rpcId: 7 }]]);
  });

  // TEST_SCENARIO: the recording route requires a non-empty option id and rejects the whole report over one empty one, so a harness frame that holds an empty id must not cost the request its row.
  it("drops an option with an empty id instead of the whole report", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });

    reporter.waiting(
      9,
      "s-1",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "session/request_permission",
        params: {
          sessionId: "s-1",
          toolCall: { title: "Run" },
          options: [
            { optionId: "", kind: "allow_once" },
            { optionId: "allow", kind: "allow_once" },
            { optionId: "no", kind: "reject_once" },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect((sent[0]![1] as { options: unknown }).options).toEqual([
      { optionId: "allow", kind: "allow_once" },
      { optionId: "no", kind: "reject_once" },
    ]);
  });

  // TEST_SCENARIO: a request can offer more options than the recording route accepts. Cutting the tail must not cut the only reject option: a row whose catalog holds no reject cannot express a denial, and the user's refusal must stay answerable.
  it("keeps a reject option that sits past the recording cap", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });
    const allows = Array.from({ length: 16 }, (_, n) => ({
      optionId: `allow-${n}`,
      kind: "allow_once",
    }));

    reporter.held(13, "s-1", "{}");
    reporter.waiting(
      13,
      "s-1",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "session/request_permission",
        params: {
          sessionId: "s-1",
          toolCall: { title: "Run" },
          options: [...allows, { optionId: "no", kind: "reject_once" }],
        },
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const options = (sent[0]![1] as { options: { optionId: string }[] })
      .options;
    expect(options).toHaveLength(16);
    expect(options.map((o) => o.optionId)).toContain("no");
  });

  // TEST_SCENARIO: the row keeps a bounded catalog, so the option the harness accepted can be one it dropped. The runtime holds the request, so its end report must state the kind the row cannot look up.
  it("reports the kind of the option the harness accepted", async () => {
    const { client, sent } = fakeClient();
    const reporter = createToolApprovalReporter({ client, log: () => {} });
    const allows = Array.from({ length: 16 }, (_, n) => ({
      optionId: `allow-${n}`,
      kind: "allow_once",
    }));

    reporter.held(14, "s-1", "{}");
    reporter.held(
      14,
      "s-1",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 14,
        method: "session/request_permission",
        params: {
          sessionId: "s-1",
          toolCall: { title: "Run" },
          options: [...allows, { optionId: "reject-17", kind: "reject_once" }],
        },
      }),
    );
    reporter.answered(14, "s-1", {
      outcome: { outcome: "selected", optionId: "reject-17" },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]?.[1]).toEqual({
      sessionId: "s-1",
      rpcId: 14,
      outcome: {
        outcome: "selected",
        optionId: "reject-17",
        kind: "reject_once",
      },
    });
  });
});
