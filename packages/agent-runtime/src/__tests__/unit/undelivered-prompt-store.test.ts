import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createSessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import {
  createUndeliveredPromptStore,
  type UndeliveredPrompt,
} from "../../modules/acp/infrastructure/undelivered-prompt-store.js";

/**
 * TEST_OVERVIEW: the store that keeps prompts which never reached the harness.
 *
 * Its whole reason to exist is outliving things: a session teardown, a pod
 * restart, and the session-metadata document it deliberately does not share.
 * None of that is reachable from a browser assertion — a Playwright spec can
 * see a recovered message come back, but not which file it came from, nor
 * that a routine turn did not rewrite it. That is what this file covers, and
 * nothing the prompt-delivery e2e specs already prove.
 */

let tick = 0;
const clock = (): string => `t${String(++tick).padStart(6, "0")}`;

function record(
  id: string,
  text: string,
  extra: Partial<UndeliveredPrompt> = {},
): UndeliveredPrompt {
  return {
    id,
    recordedAt: `r-${id}`,
    blocks: [{ type: "text", text }],
    droppedAttachments: [],
    ...extra,
  };
}

describe("createUndeliveredPromptStore", () => {
  let dir: string;
  let backend: ReturnType<typeof createFileDocumentStoreBackend>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "undelivered-"));
    mkdirSync(dirname(join(dir, ".platform/undelivered-prompts.json")), {
      recursive: true,
    });
    backend = createFileDocumentStoreBackend(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * TEST_SCENARIO: A prompt is recorded, then read back after a restart. The
   * harness never saw it, so this document is the only copy anywhere — if a
   * schema change ever made an entry fail validation it would be dropped
   * silently on read, and the text would be gone with no error.
   */
  it("keeps a prompt's content whole across a restart", () => {
    const long = "please ".repeat(2_000).trim();
    const first = createUndeliveredPromptStore(backend, clock);
    first.remember("s1", [
      record("p1", long),
      {
        ...record("p2", "look at this"),
        blocks: [
          { type: "text", text: "look at this" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      },
    ]);

    const second = createUndeliveredPromptStore(
      createFileDocumentStoreBackend(dir),
      clock,
    );
    const read = second.readFor("s1");
    expect(read[0]?.blocks).toEqual([{ type: "text", text: long }]);
    expect(read[1]?.blocks).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
  });

  /**
   * TEST_SCENARIO: Reading does not consume. A client opening the session twice
   * must see its undelivered prompts both times — an earlier design cleared
   * the record as it handed it over, so a second reload lost them for good.
   */
  it("hands the same prompts back on every read", () => {
    const store = createUndeliveredPromptStore(backend, clock);
    store.remember("s1", [record("p1", "run the migration")]);

    expect(store.readFor("s1")).toHaveLength(1);
    expect(store.readFor("s1")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: A prompt goes when it is sent again or deleted, addressed by
   * id, and the last one leaving takes the session's whole entry with it so an
   * empty shell is not carried forever.
   */
  it("forgets one prompt by id, and the session entry once it is empty", () => {
    const store = createUndeliveredPromptStore(backend, clock);
    store.remember("s1", [record("p1", "first"), record("p2", "second")]);

    store.forget("s1", "p1");
    expect(store.readFor("s1").map((p) => p.id)).toEqual(["p2"]);

    store.forget("s1", "p2");
    expect(store.readFor("s1")).toEqual([]);
    expect(
      createUndeliveredPromptStore(
        createFileDocumentStoreBackend(dir),
        clock,
      ).readFor("s1"),
    ).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Two tabs reconnect at once and both hand over the same held
   * prompt. Recording is addressed by id, so the second hand-over is a no-op
   * rather than a duplicate the user has to delete twice.
   */
  it("ignores a prompt it already holds", () => {
    const store = createUndeliveredPromptStore(backend, clock);
    store.remember("s1", [record("p1", "run the migration")]);
    store.remember("s1", [record("p1", "run the migration")]);

    expect(store.readFor("s1")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Deleting a Session takes its undelivered prompts. Routine
   * session teardown must not — the record exists precisely to outlive it —
   * so this is a separate call, and nothing else prunes an abandoned record.
   */
  it("forgets every prompt of a deleted session", () => {
    const store = createUndeliveredPromptStore(backend, clock);
    store.remember("s1", [record("p1", "first")]);
    store.remember("s2", [record("p2", "other session")]);

    store.forgetSession("s1");

    expect(store.readFor("s1")).toEqual([]);
    expect(store.readFor("s2")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Past the byte cap, whole records of stale sessions are
   * evicted rather than any prompt being trimmed — a half-kept message would
   * offer to send content the user never wrote. The session being written is
   * never the one evicted.
   */
  it("evicts stale sessions whole rather than trimming a prompt", () => {
    const store = createUndeliveredPromptStore(backend, clock);
    const bulk = "x".repeat(10 * 1024 * 1024);
    store.remember("stale", [record("p1", bulk)]);
    store.remember("fresh", [record("p2", bulk)]);

    expect(store.readFor("stale")).toEqual([]);
    expect(store.readFor("fresh")).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: The reason this store owns its own document. A routine turn
   * stamps activity on session metadata, which rewrites that document in full;
   * held prompt content must not be re-serialized on every turn, and a corrupt
   * metadata write must not take it along.
   */
  it("is untouched by the session-metadata document", () => {
    const undelivered = createUndeliveredPromptStore(backend, clock);
    const metadata = createSessionMetadataStore(backend, clock);
    undelivered.remember("s1", [record("p1", "run the migration")]);

    metadata.set("s1", {});
    for (let i = 0; i < 5; i++) metadata.recordActivity("s1");

    expect(metadata.get("s1")).toBeDefined();
    expect(
      createUndeliveredPromptStore(
        createFileDocumentStoreBackend(dir),
        clock,
      ).readFor("s1"),
    ).toHaveLength(1);
  });
});
