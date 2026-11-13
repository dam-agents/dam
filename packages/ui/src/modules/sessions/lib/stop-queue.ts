import type { QueuedPrompt } from "api-server-api";

import type { Attachment } from "../../../types.js";
import type { SessionDraft } from "./draft-key.js";

// UNIT_BOUNDARY_DESCRIPTION: What a person's Stop takes back from the queue: the prompts still waiting — the ones this UI queued, not those another surface did, and none the runtime is already starting — leave the queue before the turn is cancelled, so they do not begin the next one. Their text rejoins the composer after anything typed there, images go back as attachments, and a file a prompt carried is named as dropped since its upload cannot be staged again. A prompt the runtime starts mid-removal cannot be removed, so it stays out of the draft and runs: Stop leaves it alone like any delivered prompt. Removals run from the tail, because removing the head prompt can steer the next one into the running turn.
export async function holdQueuedPrompts({
  queue,
  draft,
  remove,
}: {
  queue: readonly QueuedPrompt[];
  draft: SessionDraft;
  remove: (promptId: string) => Promise<void>;
}): Promise<SessionDraft | null> {
  const waiting = queue.filter(
    (item) => item.editable && item.starting !== true && item.promptId !== null,
  );
  const removed = new Set<string>();
  for (const item of [...waiting].reverse()) {
    const promptId = item.promptId ?? "";
    try {
      await remove(promptId);
      removed.add(promptId);
    } catch {
      continue;
    }
  }
  const held = waiting.filter((item) => removed.has(item.promptId ?? ""));
  if (held.length === 0) return null;
  const blocks = held.flatMap((item) => item.blocks);
  const texts = blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
  const images: Attachment[] = blocks.flatMap((b) =>
    b.type === "image"
      ? [{ kind: "image" as const, data: b.data, mimeType: b.mimeType }]
      : [],
  );
  const dropped = blocks.flatMap((b) =>
    b.type === "resource_link" ? [b.name] : [],
  );
  return {
    text: [draft.text, ...texts].filter((t) => t.length > 0).join("\n\n"),
    attachments: [...draft.attachments, ...images],
    droppedAttachmentNames: [
      ...(draft.droppedAttachmentNames ?? []),
      ...dropped,
    ],
  };
}
