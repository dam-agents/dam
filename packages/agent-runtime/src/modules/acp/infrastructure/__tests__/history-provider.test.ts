import { describe, it, expect } from "vitest";
import {
  createExecHistoryProvider,
  createWorkerHistoryProvider,
} from "../history-provider.js";

/**
 * TEST_OVERVIEW: the session-history providers turn a harness image's
 * declaration into replay lines, and fail closed.
 *
 * The worker variant hosts the declared module in one persistent worker
 * thread: a per-request error or an invalid frame resolves that fetch to
 * null without killing the worker, and a module that cannot load at all
 * resolves every fetch to null. The exec variant runs the declared command
 * once per fetch with the same validation. Null always means "fall back to
 * the harness load".
 */

function frameLine(sessionId: string, text: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function dataModule(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

describe("worker history provider", () => {
  /**
   * TEST_SCENARIO: A well-behaved module resolves replay lines for a session,
   * and a second fetch reuses the same worker — the module must not be
   * reloaded per request.
   */
  it("should serve lines from the hosted module and reuse the worker", async () => {
    const source = `
      let loads = 0;
      export function loadHistory(sessionId) {
        loads += 1;
        return [${JSON.stringify(frameLine("SID", "hello"))}.replace('"SID"', JSON.stringify(sessionId)).replace("hello", "load-" + loads)];
      }
    `;
    const provider = createWorkerHistoryProvider({
      modulePath: dataModule(source),
      log: () => {},
    });
    const first = await provider.fetch("sess-a");
    const second = await provider.fetch("sess-a");
    expect(first).toHaveLength(1);
    expect(first![0]).toContain("load-1");
    expect(second![0]).toContain("load-2");
  });

  /**
   * TEST_SCENARIO: A module that throws for one session must fail only that
   * fetch — the next fetch on the same worker succeeds.
   */
  it("should fail one fetch on a module error without killing the worker", async () => {
    const source = `
      export function loadHistory(sessionId) {
        if (sessionId === "bad") throw new Error("unknown session");
        return [${JSON.stringify(frameLine("SID", "ok"))}.replace('"SID"', JSON.stringify(sessionId))];
      }
    `;
    const provider = createWorkerHistoryProvider({
      modulePath: dataModule(source),
      log: () => {},
    });
    expect(await provider.fetch("bad")).toBeNull();
    expect(await provider.fetch("good")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Frames for a different session — or non-frames — must be
   * rejected wholesale: a provider that lies about session ids cannot poison
   * the transcript.
   */
  it("should reject output with foreign or malformed frames", async () => {
    const source = `
      export function loadHistory() {
        return [${JSON.stringify(frameLine("someone-else", "spoof"))}];
      }
    `;
    const provider = createWorkerHistoryProvider({
      modulePath: dataModule(source),
      log: () => {},
    });
    expect(await provider.fetch("sess-a")).toBeNull();
  });

  /**
   * TEST_SCENARIO: A module that fails to import resolves fetches to null —
   * the fallback path decides, never an exception.
   */
  it("should resolve null when the module cannot load", async () => {
    const provider = createWorkerHistoryProvider({
      modulePath: dataModule("throw new Error('boom')"),
      log: () => {},
    });
    expect(await provider.fetch("sess-a")).toBeNull();
  });
});

describe("exec history provider", () => {
  /**
   * TEST_SCENARIO: The command variant runs the declared executable per
   * fetch, passing the session id as the final argument, and parses its
   * stdout lines with the same validation as the worker variant.
   */
  it("should serve lines printed by the declared command", async () => {
    const script =
      "process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:process.argv[1],update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'}}}})+'\\n')";
    const provider = createExecHistoryProvider({
      command: ["node", "-e", script],
      cwd: process.cwd(),
      log: () => {},
    });
    const lines = await provider.fetch("sess-a");
    expect(lines).toHaveLength(1);
    expect(lines![0]).toContain("sess-a");
  });

  /**
   * TEST_SCENARIO: The pipe delivers bytes, not characters, so a chunk
   * boundary can land inside a multi-byte UTF-8 sequence. Decoding each
   * chunk independently would turn the split character into U+FFFD while the
   * line still parses as JSON — silent corruption of replayed text. The
   * command below flushes the first half of a three-byte character, waits,
   * then writes the rest; the provider must reassemble it exactly.
   */
  it("should reassemble a multi-byte character split across stream chunks", async () => {
    const script = `
      const line = JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:process.argv[1],update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"překlad — 日本語"}}}}) + "\\n";
      const bytes = Buffer.from(line, "utf8");
      const at = line.indexOf("日");
      const cut = Buffer.byteLength(line.slice(0, at), "utf8") + 1;
      process.stdout.write(bytes.subarray(0, cut));
      setTimeout(() => process.stdout.write(bytes.subarray(cut)), 30);
    `;
    const provider = createExecHistoryProvider({
      command: ["node", "-e", script],
      cwd: process.cwd(),
      log: () => {},
    });
    const lines = await provider.fetch("sess-a");
    expect(lines).toHaveLength(1);
    expect(lines![0]).toContain("překlad — 日本語");
    expect(lines![0]).not.toContain("�");
  });

  /**
   * TEST_SCENARIO: The output budget is enforced in bytes, and exceeding it
   * fails the fetch closed — the caller falls back to the harness load
   * instead of buffering without bound.
   */
  it("should fail closed when output exceeds the byte budget", async () => {
    const messages: string[] = [];
    const provider = createExecHistoryProvider({
      command: ["node", "-e", "process.stdout.write('x'.repeat(100))"],
      cwd: process.cwd(),
      maxOutputBytes: 10,
      log: (msg) => messages.push(msg),
    });
    expect(await provider.fetch("sess-a")).toBeNull();
    expect(messages.join("\n")).toContain("output exceeded 10 bytes");
  });
});
