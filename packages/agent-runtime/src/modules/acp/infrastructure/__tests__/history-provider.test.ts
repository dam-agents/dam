import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createWorkerHistoryProvider } from "../history-provider.js";
import { prestartHistoryWorkers } from "../history-worker.js";

/**
 * TEST_OVERVIEW: the session-history providers turn a harness image's
 * declaration into replay lines, and fail closed.
 *
 * The worker variant hosts the declared module in one persistent worker
 * thread: a per-request error or an invalid frame resolves that fetch to
 * null without killing the worker, and a module that cannot load at all
 * resolves every fetch to null. Null always means "fall back to the harness
 * load".
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
   * TEST_SCENARIO: Warming imports the module before any fetch, so the first
   * load after boot does not pay the import.
   */
  it("should import the module on warm, ahead of the first fetch", async () => {
    const source = `
      const importedAt = Date.now();
      new BroadcastChannel("history-warm").postMessage("imported");
      export function loadHistory(sessionId) {
        return [${JSON.stringify(frameLine("SID", "T"))}.replace('"SID"', JSON.stringify(sessionId)).replace('"T"', JSON.stringify(String(importedAt)))];
      }
    `;
    const provider = createWorkerHistoryProvider({
      modulePath: dataModule(source),
      log: () => {},
    });
    const warmed = new BroadcastChannel("history-warm");
    const imported = new Promise((resolve) => (warmed.onmessage = resolve));
    provider.warm?.();
    await imported;
    warmed.close();
    const fetchedAt = Date.now();
    const lines = await provider.fetch("sess-a");
    const importedAt = Number(
      (
        JSON.parse(lines![0]!) as {
          params: { update: { content: { text: string } } };
        }
      ).params.update.content.text,
    );
    expect(importedAt).toBeLessThanOrEqual(fetchedAt);
  });

  /**
   * TEST_SCENARIO: The runtime's entry point starts the worker of each module
   * a runtime manifest declares before the server composes its providers, and
   * the provider of that module serves from that worker, so the module is
   * imported once and before the provider exists. A manifest that does not
   * parse starts nothing and does not stop the others.
   */
  it("should serve from the worker started for a manifest's module", async () => {
    const source = `
      const worker = String(Math.random());
      new BroadcastChannel("history-prestart").postMessage(worker);
      export function loadHistory(sessionId) {
        return [${JSON.stringify(frameLine("SID", "W"))}.replace('"SID"', JSON.stringify(sessionId)).replace('"W"', JSON.stringify(worker))];
      }
    `;
    const modulePath = dataModule(source);
    const dir = mkdtempSync(join(tmpdir(), "history-prestart-"));
    const channel = new BroadcastChannel("history-prestart");
    const prestarted = new Promise<string>((resolve) => {
      channel.onmessage = (msg: MessageEvent<string>) => resolve(msg.data);
    });
    try {
      writeFileSync(join(dir, "broken.yaml"), "sessionHistory: [");
      writeFileSync(
        join(dir, "harness.yaml"),
        `sessionHistory:\n  module: "${modulePath}"\n  exportName: loadHistory\n`,
      );
      prestartHistoryWorkers(
        [join(dir, "broken.yaml"), join(dir, "harness.yaml")],
        () => {},
      );
      const worker = await prestarted;
      const provider = createWorkerHistoryProvider({
        modulePath,
        exportName: "loadHistory",
        log: () => {},
      });
      const lines = await provider.fetch("sess-a");
      expect(lines).toHaveLength(1);
      expect(lines![0]).toContain(JSON.stringify(worker));
    } finally {
      channel.close();
      rmSync(dir, { recursive: true, force: true });
    }
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
