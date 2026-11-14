// TEST_OVERVIEW: Stop takes back the prompts still waiting in the queue, so a cancelled turn is not followed by them. They leave the queue before the cancel, tail first; their text lands in the composer after what was typed there — even text typed while they were being removed — an image comes back as an attachment, a file is named as dropped. A prompt that started while Stop was removing it is delivered, so its text stays out of the composer, and so does a prompt another surface queued.
import type { PromptBlock, QueuedPrompt } from "api-server-api";
import { expect, test } from "vitest";

import { EMPTY_DRAFT } from "../../modules/sessions/lib/draft-key.js";
import {
  holdQueuedPrompts,
  mergeHeldIntoDraft,
} from "../../modules/sessions/lib/stop-queue.js";

function queued(
  promptId: string,
  blocks: PromptBlock[],
  extra: Partial<QueuedPrompt> = {},
): QueuedPrompt {
  return { promptId, blocks, queuedAt: "", editable: true, ...extra };
}

function text(value: string): PromptBlock {
  return { type: "text", text: value };
}

const image: PromptBlock = {
  type: "image",
  data: "AAAA",
  mimeType: "image/png",
};
const file: PromptBlock = {
  type: "resource_link",
  uri: "file:///home/agent/work/report.pdf",
  name: "report.pdf",
};

function remover(failing: string[] = []) {
  const removed: string[] = [];
  return {
    removed,
    remove: (promptId: string) => {
      if (failing.includes(promptId)) {
        return Promise.reject(new Error("not queued"));
      }
      removed.push(promptId);
      return Promise.resolve();
    },
  };
}

// TEST_SCENARIO: two messages wait behind a running turn, and the person typed a draft meanwhile. Stop removes both from the queue and both texts land after the draft, in the order they were queued.
test("puts the waiting text after the draft, in queue order", async () => {
  const { removed, remove } = remover();
  const held = await holdQueuedPrompts(
    [
      queued("p1", [text("and print the date")]),
      queued("p2", [text("then stop")]),
    ],
    remove,
  );
  const draft = mergeHeldIntoDraft(
    { ...EMPTY_DRAFT, text: "typed meanwhile" },
    held!,
  );

  expect(draft.text).toBe("typed meanwhile\n\nand print the date\n\nthen stop");
  expect(draft.attachments).toEqual([]);
  expect(draft.droppedAttachmentNames).toEqual([]);
  expect(removed).toEqual(["p2", "p1"]);
});

// TEST_SCENARIO: removing the head prompt can steer the next one into the running turn, so the removals run from the tail.
test("removes from the tail", async () => {
  const { removed, remove } = remover();
  await holdQueuedPrompts(
    [
      queued("p1", [text("one")]),
      queued("p2", [text("two")]),
      queued("p3", [text("three")]),
    ],
    remove,
  );

  expect(removed).toEqual(["p3", "p2", "p1"]);
});

// TEST_SCENARIO: the removal of the third message settles before Stop returns, so nothing of it can start after the cancel; and text typed while the removals were on their way is kept, because the draft is merged when they are done, not read before them.
test("holds nothing in the draft but what it removed, merged at write time", async () => {
  let finishRemoval = () => {};
  const removal = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  const heldPromise = holdQueuedPrompts([queued("p1", [text("one")])], () =>
    removal.then(() => {}),
  );
  const typed = { ...EMPTY_DRAFT, text: "typed meanwhile" };
  finishRemoval();
  const draft = mergeHeldIntoDraft(typed, (await heldPromise)!);

  expect(draft.text).toBe("typed meanwhile\n\none");
});

// TEST_SCENARIO: a second Stop takes back the next waiting message while the first one's text still sits in the composer: both stay, in that order.
test("appends rather than replaces when two Stops run in turn", async () => {
  const first = await holdQueuedPrompts([queued("p1", [text("one")])], () =>
    Promise.resolve(),
  );
  const second = await holdQueuedPrompts([queued("p2", [text("two")])], () =>
    Promise.resolve(),
  );
  const draft = mergeHeldIntoDraft(
    mergeHeldIntoDraft(EMPTY_DRAFT, first!),
    second!,
  );

  expect(draft.text).toBe("one\n\ntwo");
});

// TEST_SCENARIO: the runtime starts the second message while Stop removes the third. It is delivered, so it is not in the queue any more and its text must not come back; the third one's does.
test("leaves a prompt that started mid-removal alone", async () => {
  const { removed, remove } = remover(["p2"]);
  const held = await holdQueuedPrompts(
    [queued("p1", [text("one")]), queued("p2", [text("two")])],
    remove,
  );

  expect(removed).toEqual(["p1"]);
  expect(held?.text).toBe("one");
});

// TEST_SCENARIO: a prompt another surface queued is not this person's to take back, and one the runtime is starting is already on its way; both stay queued and neither reaches the composer. Nothing removed means no draft change at all.
test("holds back only the prompts this UI queued and none that is starting", async () => {
  const { removed, remove } = remover();
  const untouched = await holdQueuedPrompts(
    [
      queued("p1", [text("from slack")], { editable: false }),
      queued("p2", [text("starting")], { starting: true }),
    ],
    remove,
  );

  expect(untouched).toBeNull();
  expect(removed).toEqual([]);
});

// TEST_SCENARIO: a waiting prompt carries a pasted image and a file from the workspace. The image can be staged again, so it goes back with the text; the file cannot — the composer keeps its name as dropped, which the composer reports.
test("brings an image back as an attachment and names a dropped file", async () => {
  const held = await holdQueuedPrompts(
    [queued("p1", [image, file, text("look at both")])],
    () => Promise.resolve(),
  );
  const draft = mergeHeldIntoDraft(
    { ...EMPTY_DRAFT, droppedAttachmentNames: ["earlier.txt"] },
    held!,
  );

  expect(draft.text).toBe("look at both");
  expect(draft.attachments).toEqual([
    { kind: "image", data: "AAAA", mimeType: "image/png" },
  ]);
  expect(draft.droppedAttachmentNames).toEqual(["earlier.txt", "report.pdf"]);
});

// TEST_SCENARIO: a queued chat-form answer carries its form in renderer blocks around the text; the composer never shows them, so a message taken back reads as what the person typed.
test("keeps only the typed text of a prompt that carries a form", async () => {
  const held = await holdQueuedPrompts(
    [queued("p1", [text("<a2ui-message>{}</a2ui-message>my answer")])],
    () => Promise.resolve(),
  );

  expect(held?.text).toBe("my answer");
});
