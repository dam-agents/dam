import type { PlatformContinuedFrom } from "api-server-api";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import type { Message } from "../../../types.js";
import { ChatMessage } from "./chat-message.js";
import { ThreadDivider } from "./thread-divider.js";

const FOLD_CHARS = 4_000;

const noop = () => {};

interface Props {
  copy: PlatformContinuedFrom;
  avatarAgent?: { name: string; avatar: string | null };
}

function copiedMessage(
  id: string,
  role: Message["role"],
  text: string,
): Message {
  return { id, role, parts: [{ kind: "text", text }], streaming: false };
}

export function ContinuedFromPrelude({ copy, avatarAgent }: Props) {
  const [prompt, result] = useMemo(
    () => [
      copiedMessage(
        `continued:${copy.invocationId}:prompt`,
        "user",
        copy.prompt,
      ),
      copiedMessage(
        `continued:${copy.invocationId}:result`,
        "assistant",
        copy.result,
      ),
    ],
    [copy],
  );
  const foldable = copy.result.length > FOLD_CHARS;
  const [open, setOpen] = useState(false);
  const bubble = (message: Message) => (
    <ChatMessage
      message={message}
      avatarAgent={avatarAgent}
      readOnly
      isLast={false}
      hasPendingPermission={false}
      onRetry={noop}
      onFileClick={noop}
      onDelete={noop}
    />
  );

  return (
    <div data-testid="continued-from-prelude" className="flex flex-col gap-6">
      {bubble(prompt)}
      {copy.result.trim() !== "" && (
        <div className="flex flex-col gap-2">
          <div
            className={cn(
              foldable &&
                !open &&
                "max-h-96 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
            )}
          >
            {bubble(result)}
          </div>
          {foldable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="self-start text-xs text-muted-foreground hover:text-foreground"
            >
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      )}
      <ThreadDivider
        label={`Continued from sub-agent session (${copy.label})`}
      />
    </div>
  );
}
