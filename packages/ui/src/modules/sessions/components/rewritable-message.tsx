import { Branch, Undo } from "@carbon/icons-react";
import { joinRendererBlocks, separateRendererBlocks } from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { extractErrorMessage } from "../../acp/errors.js";
import { messageText } from "../lib/unanswered-prompt.js";
import type { RewriteMode } from "../store/sessions.js";
import { MessageEditor } from "./message-editor.js";

const EDITOR_COPY: Record<RewriteMode, { label: string; save: string }> = {
  rewind: { label: "Rewind to this message", save: "Rewind and send" },
  fork: { label: "Fork from this message", save: "Fork and send" },
};

export function RewritableMessage({
  message,
  enabled,
  onRewrite,
  children,
}: {
  message: Message;
  enabled: boolean;
  onRewrite: (mode: RewriteMode, text: string) => Promise<void>;
  children: (actions: ReactNode) => ReactNode;
}) {
  const rewriting = useStore((s) => s.rewriting);
  const setRewriting = useStore((s) => s.setRewriting);
  const [pending, setPending] = useState(false);
  const mode = rewriting?.messageId === message.id ? rewriting.mode : null;
  const original = separateRendererBlocks(messageText(message));

  const save = async (text: string) => {
    if (mode === null) return;
    setPending(true);
    try {
      await onRewrite(mode, joinRendererBlocks(text, original.blocks));
    } catch (err) {
      emitToast({ kind: "error", message: extractErrorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  if (mode !== null) {
    return (
      <div className="flex w-full flex-col items-end gap-1">
        <span className="text-[11px] text-muted-foreground">
          {EDITOR_COPY[mode].label}
        </span>
        <MessageEditor
          initial={original.text}
          pending={pending}
          canSave={enabled}
          saveLabel={EDITOR_COPY[mode].save}
          saveVariant={mode === "rewind" ? "destructive" : "default"}
          onSave={(text) => void save(text)}
          onCancel={() => setRewriting(null)}
        />
      </div>
    );
  }

  return children(
    enabled && rewriting === null && (
      <>
        <Button
          variant="ghost"
          size="icon-xs"
          tooltip="Rewind"
          aria-label="Rewind"
          onClick={() =>
            setRewriting({ messageId: message.id, mode: "rewind" })
          }
        >
          <Undo size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          tooltip="Fork"
          aria-label="Fork"
          onClick={() => setRewriting({ messageId: message.id, mode: "fork" })}
        >
          <Branch size={14} />
        </Button>
      </>
    ),
  );
}

export function RewriteMarker({
  mode,
  following,
}: {
  mode: RewriteMode;
  following: number;
}) {
  if (mode === "rewind" && following === 0) return null;
  const text =
    mode === "fork"
      ? "This conversation stays as it is. A new one continues from here."
      : following === 1
        ? "The message below will be removed."
        : `The ${String(following)} messages below will be removed.`;
  return (
    <div
      role="note"
      className={
        mode === "rewind"
          ? "flex items-center gap-3 text-xs text-danger before:flex-1 before:border-t before:border-dashed before:border-danger after:flex-1 after:border-t after:border-dashed after:border-danger"
          : "flex items-center gap-3 text-xs text-accent before:flex-1 before:border-t before:border-dashed before:border-accent after:flex-1 after:border-t after:border-dashed after:border-accent"
      }
    >
      {text}
    </div>
  );
}
