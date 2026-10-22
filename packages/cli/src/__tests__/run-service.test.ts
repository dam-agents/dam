import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import {
  choicesOrInvalid,
  resolvePrompt,
} from "../modules/chat/commands/run.js";
import { ok } from "../result.js";
import {
  createRunService,
  stallLine,
  type RunService,
} from "../modules/chat/services/run-service.js";

/**
 * TEST_OVERVIEW: The headless run service (`dam run`). Against a fake ACP relay it must
 * open a `cli_run` session, submit the prompt with a minted promptId, stream
 * `agent_message_chunk` text to its output as it arrives, and map the prompt
 * response's stopReason into the outcome. When the socket drops mid-turn it
 * must reconnect, re-load the session, and finish from the pod's run-result
 * record — printing only the text it has not already printed. `get` reads the
 * record without running anything. Prompt-source resolution takes exactly one
 * of flag and file.
 */

type Frame = Record<string, unknown> & { method?: string; id?: number };

interface FakeRelay {
  host: string;
  connections: number;
  close(): void;
}

function startRelay(
  onFrame: (ws: WebSocket, frame: Frame, connection: number) => void,
  initializeResult: unknown = {},
): FakeRelay {
  const wss = new WebSocketServer({ port: 0 });
  const relay: FakeRelay = {
    host: "",
    connections: 0,
    close: () => wss.close(),
  };
  wss.on("connection", (ws) => {
    relay.connections += 1;
    const connection = relay.connections;
    ws.on("message", (data) => {
      const frame = JSON.parse(String(data)) as Frame;
      if (frame.method === "initialize") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            result: initializeResult,
          }),
        );
        return;
      }
      onFrame(ws, frame, connection);
    });
  });
  const { port } = wss.address() as { port: number };
  relay.host = `http://127.0.0.1:${port}`;
  return relay;
}

function reply(ws: WebSocket, id: number | undefined, result: unknown): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(ws: WebSocket, method: string, params: unknown): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
}

function chunk(ws: WebSocket, sessionId: string, text: string): void {
  notify(ws, "session/update", {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}

function serviceFor(relay: FakeRelay): {
  service: RunService;
  printed: () => string;
  errors: string[];
} {
  const out: string[] = [];
  const errors: string[] = [];
  const service = createRunService({
    bootstrap: () =>
      Promise.resolve(ok({ host: relay.host, token: "t", agentId: "agent-1" })),
    out: (text) => out.push(text),
    errOut: (text) => errors.push(text),
    reconnectBackoffMs: [10],
  });
  return { service, printed: () => out.join(""), errors };
}

function egressPrompt(ws: WebSocket, approvalId: string): void {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: approvalId,
      method: "session/request_permission",
      params: {
        sessionId: `_egress:${approvalId}`,
        options: [],
        toolCall: {
          title: "GET api.example.com/v1",
          rawInput: { approvalId },
        },
      },
    }),
  );
}

describe("run service", () => {
  let relay: FakeRelay | undefined;

  afterEach(() => {
    relay?.close();
    relay = undefined;
  });

  /**
   * TEST_SCENARIO: The straight-line CI case: fresh session, one prompt, streamed answer.
   * The streamed text must reach the output in order and the stopReason must
   * come back on the outcome.
   */
  it("streams the answer and completes on the prompt response", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new") {
        reply(ws, frame.id, { sessionId: "sess-1" });
        return;
      }
      if (frame.method === "session/prompt") {
        chunk(ws, "sess-1", "hello ");
        chunk(ws, "sess-1", "world");
        reply(ws, frame.id, { stopReason: "end_turn" });
      }
    });
    const { service, printed } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "greet",
      timeoutSeconds: 10,
    });

    expect(result).toEqual(
      ok({ kind: "completed", sessionId: "sess-1", stopReason: "end_turn" }),
    );
    expect(printed()).toBe("hello world");
  });

  /**
   * TEST_SCENARIO: #4010. Claude Code answers the prompt while its background
   * agents still report, and works on in an Autonomous Turn. A runtime that
   * announces `runEnded` sends `platform/runEnded` once the harness is idle,
   * and the run must end there, not at the prompt answer: the text of the
   * Autonomous Turn is printed, and the outcome carries the run's stop reason.
   */
  it("ends the run at platform/runEnded when the runtime announces it", async () => {
    relay = startRelay(
      (ws, frame) => {
        if (frame.method === "session/new") {
          reply(ws, frame.id, { sessionId: "sess-1" });
          return;
        }
        if (frame.method === "session/prompt") {
          const promptId = (
            frame.params as { _meta: { platform: { promptId: string } } }
          )._meta.platform.promptId;
          chunk(ws, "sess-1", "A=1 ");
          reply(ws, frame.id, { stopReason: "end_turn" });
          setTimeout(() => {
            chunk(ws, "sess-1", "C=3");
            notify(ws, "platform/runEnded", {
              sessionId: "sess-1",
              promptId,
              stopReason: "cancelled",
            });
          }, 50);
        }
      },
      { _meta: { platform: { runEnded: true } } },
    );
    const { service, printed } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "fan out",
      timeoutSeconds: 10,
    });

    expect(result).toEqual(
      ok({ kind: "completed", sessionId: "sess-1", stopReason: "cancelled" }),
    );
    expect(printed()).toBe("A=1 C=3");
  });

  /**
   * TEST_SCENARIO: `dam run get --wait` on a run whose prompt was answered
   * while the harness still works: the record stays `pending` until
   * `platform/runEnded`, and the wait must end on that signal with the full
   * record.
   */
  it("finishes get --wait on platform/runEnded", async () => {
    let ended = false;
    relay = startRelay((ws, frame) => {
      if (frame.method === "platform/runResult") {
        reply(
          ws,
          frame.id,
          ended
            ? {
                status: "done",
                result: {
                  promptId: "p1",
                  stopReason: "end_turn",
                  finalText: "A=1 C=3",
                  truncated: false,
                  endedAt: "2026-01-01T00:00:00Z",
                },
              }
            : { status: "pending" },
        );
        return;
      }
      if (frame.method === "session/load") {
        reply(ws, frame.id, {});
        setTimeout(() => {
          ended = true;
          notify(ws, "platform/runEnded", {
            sessionId: "sess-1",
            promptId: "p1",
            stopReason: "end_turn",
          });
        }, 50);
      }
    });
    const { service } = serviceFor(relay);

    const result = await service.get({
      agentRef: "agent-1",
      sessionId: "sess-1",
      wait: true,
      timeoutSeconds: 10,
    });

    expect(result.ok && result.value.kind === "done").toBe(true);
    expect(
      result.ok && result.value.kind === "done" && result.value.result,
    ).toMatchObject({ finalText: "A=1 C=3" });
  });

  /**
   * TEST_SCENARIO: A client that retries a held request gets the egress prompt of
   * the same approval once per retry (#4327). The run must print the stall
   * line for that approval once, not once per retry.
   */
  it("prints one stall line per approval however often its prompt repeats", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new") {
        reply(ws, frame.id, { sessionId: "sess-1" });
        return;
      }
      if (frame.method === "session/prompt") {
        egressPrompt(ws, "appr-1");
        egressPrompt(ws, "appr-1");
        egressPrompt(ws, "appr-2");
        egressPrompt(ws, "appr-1");
        setTimeout(() => reply(ws, frame.id, { stopReason: "end_turn" }), 50);
      }
    });
    const { service, errors } = serviceFor(relay);

    await service.run({
      agentRef: "agent-1",
      prompt: "go",
      timeoutSeconds: 10,
    });

    expect(errors).toEqual([
      "run stalled on a permission request (GET api.example.com/v1) — resolve with: dam approval approve appr-1",
      "run stalled on a permission request (GET api.example.com/v1) — resolve with: dam approval approve appr-2",
    ]);
  });

  /**
   * TEST_SCENARIO: The socket dies mid-turn. The turn keeps running agent-side, so the
   * service must reconnect, re-load the session, read the run-result record,
   * and print only the remainder it had not streamed yet.
   */
  it("finishes from the run record after a mid-turn disconnect", async () => {
    relay = startRelay((ws, frame, connection) => {
      if (connection === 1) {
        if (frame.method === "session/new") {
          reply(ws, frame.id, { sessionId: "sess-1" });
          return;
        }
        if (frame.method === "session/prompt") {
          chunk(ws, "sess-1", "part one, ");
          ws.terminate();
        }
        return;
      }
      if (frame.method === "session/load") {
        reply(ws, frame.id, {});
        return;
      }
      if (frame.method === "platform/runResult") {
        reply(ws, frame.id, {
          status: "done",
          result: {
            promptId: null,
            stopReason: "end_turn",
            finalText: "part one, part two",
            truncated: false,
            endedAt: "2026-01-01T00:00:00Z",
          },
        });
      }
    });
    const { service, printed } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "long task",
      timeoutSeconds: 30,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: "completed",
        stopReason: "end_turn",
      });
    }
    expect(printed()).toBe("part one, part two");
  }, 15_000);

  /**
   * TEST_SCENARIO: `--async` stdout is machine-read (`SID=$(dam run --async …)`), so the
   * outcome must arrive at promptStarted with no assistant text leaking into
   * the output — even when the agent starts answering immediately.
   */
  it("prints nothing and exits at promptStarted in async mode", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new") {
        reply(ws, frame.id, { sessionId: "sess-1" });
        return;
      }
      if (frame.method === "session/prompt") {
        chunk(ws, "sess-1", "leaky text");
        const promptId = (
          frame.params as { _meta: { platform: { promptId: string } } }
        )._meta.platform.promptId;
        notify(ws, "platform/promptStarted", { sessionId: "sess-1", promptId });
      }
    });
    const { service, printed } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "go",
      async: true,
      timeoutSeconds: 10,
    });

    expect(result).toEqual(ok({ kind: "async-started", sessionId: "sess-1" }));
    expect(printed()).toBe("");
  });

  /**
   * TEST_SCENARIO: A `--session` continuation suppresses another turn's live chunks until
   * its own prompt starts — but must not lose its own text when the started
   * signal and the first chunk arrive back to back.
   */
  it("streams a --session turn's text from the promptStarted signal on", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/load") {
        reply(ws, frame.id, {});
        return;
      }
      if (frame.method === "session/prompt") {
        const promptId = (
          frame.params as { _meta: { platform: { promptId: string } } }
        )._meta.platform.promptId;
        notify(ws, "platform/promptStarted", { sessionId: "sess-1", promptId });
        chunk(ws, "sess-1", "continued answer");
        reply(ws, frame.id, { stopReason: "end_turn" });
      }
    });
    const { service, printed } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "again",
      sessionId: "sess-1",
      timeoutSeconds: 10,
    });

    expect(result).toEqual(
      ok({ kind: "completed", sessionId: "sess-1", stopReason: "end_turn" }),
    );
    expect(printed()).toBe("continued answer");
  });

  /**
   * TEST_SCENARIO: `dam run get` on a finished run must return the record without touching
   * the session; on a running one it must say pending rather than done.
   */
  it("reads the recorded result with get", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "platform/runResult") {
        const sid = (frame.params as { sessionId: string }).sessionId;
        reply(
          ws,
          frame.id,
          sid === "sess-done"
            ? {
                status: "done",
                result: {
                  promptId: "p1",
                  stopReason: "end_turn",
                  finalText: "answer",
                  truncated: false,
                  endedAt: "2026-01-01T00:00:00Z",
                },
              }
            : { status: "pending" },
        );
      }
    });
    const { service } = serviceFor(relay);

    const done = await service.get({
      agentRef: "agent-1",
      sessionId: "sess-done",
      timeoutSeconds: 10,
    });
    expect(done.ok && done.value.kind === "done").toBe(true);

    const pending = await service.get({
      agentRef: "agent-1",
      sessionId: "sess-running",
      timeoutSeconds: 10,
    });
    expect(pending).toEqual(ok({ kind: "pending", sessionId: "sess-running" }));
  });

  /**
   * TEST_SCENARIO: A failed run-state read must never read as "the run stopped": on an
   * agent that errors `platform/runResult`, cancel reports the failure instead
   * of claiming there is nothing to cancel, and sends no `session/cancel`.
   */
  it("reports a failed run-state read on cancel instead of not-running", async () => {
    const cancels: string[] = [];
    relay = startRelay((ws, frame) => {
      if (frame.method === "platform/runResult") {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32601, message: "unknown method" },
          }),
        );
        return;
      }
      if (frame.method === "session/cancel") cancels.push("sent");
    });
    const { service } = serviceFor(relay);

    const result = await service.cancel({
      agentRef: "agent-1",
      sessionId: "sess-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("run-failed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cancels).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The relay accepts the socket and then closes it because it
   * could not wake the agent, as it does for an agent waiting for memory. The
   * run says the agent could not start and why, read from the agent's state,
   * rather than only that it could not connect.
   */
  it("says why the agent could not start when the relay closes before answering", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (ws) =>
      ws.close(1011, "agent not ready: over-budget"),
    );
    const { port } = wss.address() as { port: number };
    relay = {
      host: `http://127.0.0.1:${String(port)}`,
      connections: 0,
      close: () => wss.close(),
    };
    const service = createRunService({
      bootstrap: () =>
        Promise.resolve(
          ok({ host: relay!.host, token: "t", agentId: "agent-1" }),
        ),
      out: () => {},
      errOut: () => {},
      whyNotStarted: async () => "your VM agents' memory is full",
    });

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "hi",
      timeoutSeconds: 10,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "agent-unreachable",
        why: "your VM agents' memory is full",
      },
    });
  });
});

describe("run service: session choices", () => {
  let relay: FakeRelay | undefined;

  afterEach(() => {
    relay?.close();
    relay = undefined;
  });

  /**
   * TEST_SCENARIO: `dam run --harness/--model/--setting` is a one-off choice
   * for the new session: it travels in `session/new` as the web chat's pick
   * does, and the session keeps its own choice instead of following the
   * chat default.
   */
  it("sends the chosen harness, model and settings in session/new", async () => {
    let meta: unknown;
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new") {
        meta = (frame.params as { _meta: { platform: unknown } })._meta
          .platform;
        reply(ws, frame.id, { sessionId: "sess-1" });
        return;
      }
      if (frame.method === "session/prompt")
        reply(ws, frame.id, { stopReason: "end_turn" });
    });
    const { service } = serviceFor(relay);

    await service.run({
      agentRef: "agent-1",
      prompt: "go",
      choices: {
        harness: "codex",
        model: "ibm/gpt-5.5",
        settings: { effort: "high" },
      },
      timeoutSeconds: 10,
    });

    expect(meta).toEqual({
      mode: "chat",
      type: "cli_run",
      harness: "codex",
      model: "ibm/gpt-5.5",
      settings: { effort: "high" },
      follows: null,
    });
  });

  /**
   * TEST_SCENARIO: with no choice the frame names none, so the relay fills
   * in the agent's chat default and the session follows it.
   */
  it("names no harness or model without a choice", async () => {
    let meta: unknown;
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new") {
        meta = (frame.params as { _meta: { platform: unknown } })._meta
          .platform;
        reply(ws, frame.id, { sessionId: "sess-1" });
        return;
      }
      if (frame.method === "session/prompt")
        reply(ws, frame.id, { stopReason: "end_turn" });
    });
    const { service } = serviceFor(relay);

    await service.run({
      agentRef: "agent-1",
      prompt: "go",
      timeoutSeconds: 10,
    });

    expect(meta).toEqual({ mode: "chat", type: "cli_run" });
  });

  /**
   * TEST_SCENARIO: the runtime refuses a session with no model and names the
   * web app's Providers page; the CLI adds the commands that fix it from
   * the terminal.
   */
  it("adds the CLI's way out to a no-model refusal", async () => {
    relay = startRelay((ws, frame) => {
      if (frame.method === "session/new")
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: {
              code: -32001,
              message: "This session has no model.",
              data: { platform: { reason: "no-model" } },
            },
          }),
        );
    });
    const { service } = serviceFor(relay);

    const result = await service.run({
      agentRef: "agent-1",
      prompt: "go",
      timeoutSeconds: 10,
    });

    expect(result.ok).toBe(false);
    const reason =
      !result.ok && "reason" in result.error ? result.error.reason : "";
    expect(reason).toContain("This session has no model.");
    expect(reason).toContain("dam agent models <agent>");
    expect(reason).toContain("dam agent update <agent> --model");
  });
});

describe("stallLine", () => {
  /**
   * TEST_SCENARIO: A stall message must name the approval and the command that clears it:
   * a synthetic egress request carries its approval id inline, and a
   * harness-native request's approvals row id is derived from agent, session
   * and rpc id — the same scheme the api-server mirrors it under.
   */
  it("names the approval id and the approve command", () => {
    expect(
      stallLine("agent-1", {
        rpcId: "appr-9",
        params: {
          sessionId: "_egress:appr-9",
          toolCall: {
            title: "GET api.example.com/v1",
            rawInput: { approvalId: "appr-9" },
          },
        },
      }),
    ).toBe(
      "run stalled on a permission request (GET api.example.com/v1) — resolve with: dam approval approve appr-9",
    );
    expect(
      stallLine("agent-1", {
        rpcId: 7,
        params: { sessionId: "sess-1", toolCall: { title: "bash" } },
      }),
    ).toBe(
      "run stalled on a permission request (bash) — resolve with: dam approval approve acpnative:agent-1:sess-1:7",
    );
  });
});

describe("resolvePrompt", () => {
  const readFile = (path: string): string => `from:${path}`;

  /**
   * TEST_SCENARIO: Exactly one prompt source: both flags together and neither at all are
   * user errors; each flag alone resolves.
   */
  it("takes exactly one of --prompt and --prompt-file", () => {
    expect(resolvePrompt({ prompt: "hi", readFile })).toEqual(ok("hi"));
    expect(resolvePrompt({ promptFile: "-", readFile })).toEqual(ok("from:-"));
    expect(resolvePrompt({ readFile }).ok).toBe(false);
    expect(resolvePrompt({ prompt: "hi", promptFile: "f", readFile }).ok).toBe(
      false,
    );
  });
});

describe("choicesOrInvalid", () => {
  /**
   * TEST_SCENARIO: a session from --session already runs on its own pair,
   * so a choice beside it is refused instead of ignored.
   */
  it("takes choices for a new session only", () => {
    expect(choicesOrInvalid({ setting: [] })).toEqual(ok(undefined));
    expect(
      choicesOrInvalid({ model: "ibm/gpt-5.5", setting: ["effort=high"] }),
    ).toEqual(ok({ model: "ibm/gpt-5.5", settings: { effort: "high" } }));
    expect(
      choicesOrInvalid({ session: "s", model: "ibm/gpt-5.5", setting: [] }).ok,
    ).toBe(false);
    expect(choicesOrInvalid({ setting: ["effort"] }).ok).toBe(false);
  });
});
