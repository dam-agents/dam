import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import {
  createUndeliveredPromptStore,
  type UndeliveredPrompt,
} from "../../modules/acp/infrastructure/undelivered-prompt-store.js";

/**
 * TEST_OVERVIEW: the one property of the undelivered-prompt store that no
 * browser assertion can reach — what it does when it runs out of room.
 *
 * Everything else this store does is a step in a user's trajectory and is
 * covered there, by `full/prompt-delivery/undelivered.spec.ts`: a prompt
 * outliving a closed tab, coming back on the next visit, coming back again on
 * the visit after that, and leaving when it is sent or deleted. Asserting
 * those here instead would mean trusting a fake document store to behave like
 * the real one.
 *
 * The byte cap is different: reaching it takes megabytes of pasted image, so
 * a Playwright spec cannot drive it, and a wrong answer is silent — a
 * half-kept record would offer to send content the user never wrote.
 */

let tick = 0;
const clock = (): string => `t${String(++tick).padStart(6, "0")}`;

function record(id: string, text: string): UndeliveredPrompt {
  return {
    id,
    recordedAt: `r-${id}`,
    blocks: [{ type: "text", text }],
    droppedAttachments: [],
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
});
