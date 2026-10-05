import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createSubAgentSessionStore } from "../../modules/acp/infrastructure/sub-agent-session-store.js";

/**
 * TEST_OVERVIEW: Which Session spawned each sub-agent, on the pod's own disk.
 * It must survive a restart, since an outcome may wake the Agent from
 * hibernation; it answers for any one of the ids an outcome names; it keeps
 * only the newest entries so it cannot grow without bound; and a re-recorded
 * id counts as newest, so an id spawned again is not the first to go.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sub-agent-sessions-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () =>
  createSubAgentSessionStore(createFileDocumentStoreBackend(dir));

describe("the sub-agent session store", () => {
  it("answers the session for any id an outcome names, across a fresh backend", () => {
    open().record("session-1", ["agent-a", "agent-b"]);
    const reopened = open();
    expect(reopened.sessionOf(["agent-b"])).toBe("session-1");
    expect(reopened.sessionOf(["agent-x", "agent-a"])).toBe("session-1");
    expect(reopened.sessionOf(["agent-x"])).toBeNull();
  });

  it("keeps only the newest thousand entries", () => {
    const store = open();
    store.record("session-old", ["agent-first"]);
    store.record(
      "session-bulk",
      Array.from({ length: 1000 }, (_, i) => `agent-${i}`),
    );
    expect(store.sessionOf(["agent-first"])).toBeNull();
    expect(store.sessionOf(["agent-0"])).toBe("session-bulk");
    expect(store.sessionOf(["agent-999"])).toBe("session-bulk");
  });

  it("treats a re-recorded id as newest", () => {
    const store = open();
    store.record("session-1", ["agent-a"]);
    store.record(
      "session-bulk",
      Array.from({ length: 999 }, (_, i) => `agent-${i}`),
    );
    store.record("session-2", ["agent-a"]);
    store.record("session-3", ["agent-new"]);
    expect(store.sessionOf(["agent-a"])).toBe("session-2");
    expect(store.sessionOf(["agent-0"])).toBeNull();
  });
});
