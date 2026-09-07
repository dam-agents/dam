import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { resolvePrompt } from "../modules/chat/commands/run.js";
import { ok } from "../result.js";
import {
  createRunService,
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
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }));
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
} {
  const out: string[] = [];
  const service = createRunService({
    bootstrap: () =>
      Promise.resolve(ok({ host: relay.host, token: "t", agentId: "agent-1" })),
    out: (text) => out.push(text),
    errOut: () => {},
  });
  return { service, printed: () => out.join("") };
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
    expect(cancels).toEqual([]);
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
