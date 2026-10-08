import { Edit, TrashCan } from "@carbon/icons-react";
import type { PromptBlock, QueuedPrompt } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { extractErrorMessage, isNotQueuedError } from "../../acp/errors.js";
import { partsOf } from "../../acp/session-projection.js";
import {
  removeQueuedPrompt,
  updateQueuedPrompt,
} from "../api/acp-session-ops.js";
import { ChatMessage } from "./chat-message.js";
import { MessageEditor } from "./message-editor.js";

const ALREADY_SENT = "Already sent — it can no longer be changed.";

function queuedMessage(item: QueuedPrompt, index: number): Message {
  return {
    id: item.promptId ?? `queued-${String(index)}`,
    role: "user",
    parts: partsOf(item),
    streaming: false,
    queued: true,
  };
}

function textOf(blocks: PromptBlock[]): string {
  return blocks
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n\n");
}

function withText(blocks: PromptBlock[], text: string): PromptBlock[] {
  return [
    ...blocks.filter((b) => b.type !== "text"),
    ...(text ? [{ type: "text" as const, text }] : []),
  ];
}

function reportEditFailure(err: unknown): void {
  emitToast({
    kind: "error",
    message: isNotQueuedError(err) ? ALREADY_SENT : extractErrorMessage(err),
  });
}

const noop = () => {};

function QueuedPromptItem({
  item,
  index,
  onFileClick,
}: {
  item: QueuedPrompt;
  index: number;
  onFileClick: (path: string) => void;
}) {
  const agentId = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const target =
    item.editable && item.promptId !== null && agentId && sessionId
      ? { agentId, sessionId, promptId: item.promptId }
      : null;

  const run = async (op: () => Promise<void>) => {
    setPending(true);
    try {
      await op();
      setDraft(null);
    } catch (err) {
      reportEditFailure(err);
      if (isNotQueuedError(err)) setDraft(null);
    } finally {
      setPending(false);
    }
  };

  const save = (text: string) => {
    if (target === null) return;
    const blocks = withText(item.blocks, text);
    if (blocks.length === 0) return;
    void run(() =>
      updateQueuedPrompt(
        target.agentId,
        target.sessionId,
        target.promptId,
        blocks,
      ),
    );
  };

  const remove = () => {
    if (target === null) return;
    void run(() =>
      removeQueuedPrompt(target.agentId, target.sessionId, target.promptId),
    );
  };

  if (draft !== null) {
    return (
      <MessageEditor
        initial={draft}
        pending={pending}
        onSave={save}
        onCancel={() => setDraft(null)}
      />
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <ChatMessage
        message={queuedMessage(item, index)}
        isLast={false}
        hasPendingPermission={false}
        onRetry={noop}
        onFileClick={onFileClick}
        onDelete={noop}
      />
      {target !== null && (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit queued message"
            disabled={pending}
            onClick={() => setDraft(textOf(item.blocks))}
          >
            <Edit size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete queued message"
            disabled={pending}
            onClick={remove}
          >
            <TrashCan size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function QueuedPrompts({
  onFileClick,
}: {
  onFileClick: (path: string) => void;
}) {
  const items = useStore((s) => s.queuedPrompts);
  return items.map((item, i) => (
    <QueuedPromptItem
      key={item.promptId ?? `queued-${String(i)}`}
      item={item}
      index={i}
      onFileClick={onFileClick}
    />
  ));
}
