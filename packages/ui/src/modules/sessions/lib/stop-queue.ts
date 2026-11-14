import { type QueuedPrompt, separateRendererBlocks } from "api-server-api";

import type { Attachment } from "../../../types.js";
import type { SessionDraft } from "./draft-key.js";

export interface HeldFromQueue {
  text: string;
  attachments: Attachment[];
  droppedAttachmentNames: string[];
}

// UNIT_BOUNDARY_DESCRIPTION: What a person's Stop takes back from the queue: the prompts still waiting — the ones this UI queued, not those another surface did, and none the runtime is already starting — leave the queue before the turn is cancelled, so they do not begin the next one. A prompt's text comes back with the renderer blocks the composer never shows stripped out, images come back as attachments, and a file it carried is named as dropped since its upload cannot be staged again. A prompt the runtime starts mid-removal refuses the removal, so it stays out of what comes back and runs: Stop leaves it alone like any delivered prompt. Removals run from the tail, because removing the head prompt can steer the next one into the running turn.
export async function holdQueuedPrompts(
  queue: readonly QueuedPrompt[],
  remove: (promptId: string) => Promise<void>,
): Promise<HeldFromQueue | null> {
  const waiting = queue.flatMap((item) =>
    item.editable && item.starting !== true && item.promptId !== null
      ? [{ item, promptId: item.promptId }]
      : [],
  );
  const removed = new Set<string>();
  for (const { promptId } of [...waiting].reverse()) {
    try {
      await remove(promptId);
      removed.add(promptId);
    } catch {
      continue;
    }
  }
  const held = waiting.filter(({ promptId }) => removed.has(promptId));
  if (held.length === 0) return null;
  const blocks = held.flatMap(({ item }) => item.blocks);
  const texts = blocks.flatMap((b) =>
    b.type === "text" ? [separateRendererBlocks(b.text).text] : [],
  );
  const images: Attachment[] = blocks.flatMap((b) =>
    b.type === "image"
      ? [{ kind: "image" as const, data: b.data, mimeType: b.mimeType }]
      : [],
  );
  const dropped = blocks.flatMap((b) =>
    b.type === "resource_link" ? [b.name] : [],
  );
  return {
    text: texts.filter((t) => t.length > 0).join("\n\n"),
    attachments: images,
    droppedAttachmentNames: dropped,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the composer's draft with what Stop held added after it — the text below blank lines, the images attached beside the ones already staged, the dropped files named beside the ones already dropped — so a draft typed or an earlier Stop's text is never lost.
export function mergeHeldIntoDraft(
  draft: SessionDraft,
  held: HeldFromQueue,
): SessionDraft {
  return {
    text: [draft.text, held.text].filter((t) => t.length > 0).join("\n\n"),
    attachments: [...draft.attachments, ...held.attachments],
    droppedAttachmentNames: [
      ...(draft.droppedAttachmentNames ?? []),
      ...held.droppedAttachmentNames,
    ],
  };
}
