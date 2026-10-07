import type { QueuedPrompt } from "api-server-api";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { partsOf } from "../../acp/session-projection.js";
import { ChatMessage } from "./chat-message.js";

function queuedMessage(item: QueuedPrompt, index: number): Message {
  return {
    id: item.promptId ?? `queued-${String(index)}`,
    role: "user",
    parts: partsOf(item),
    streaming: false,
    queued: true,
  };
}

const noop = () => {};

export function QueuedPrompts({
  onFileClick,
}: {
  onFileClick: (path: string) => void;
}) {
  const items = useStore((s) => s.queuedPrompts);
  return items.map((item, i) => {
    const message = queuedMessage(item, i);
    return (
      <ChatMessage
        key={message.id}
        message={message}
        isLast={false}
        hasPendingPermission={false}
        onRetry={noop}
        onFileClick={onFileClick}
        onDelete={noop}
      />
    );
  });
}
