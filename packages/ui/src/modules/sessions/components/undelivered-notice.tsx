import { OverflowMenuVertical, Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopy } from "@/hooks/use-copy";

import { emitToast } from "../../../lib/toast.js";
import type { Attachment, Message } from "../../../types.js";
import { describeSendError } from "../../acp/errors.js";
import type { SendPromptOptions } from "../hooks/use-acp-prompt.js";

export type OnRetry = (
  text: string,
  attachments?: Attachment[],
  opts?: Pick<SendPromptOptions, "retryOf" | "blocks">,
) => void;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the only place retry arguments are assembled, so
 * a resend carries the whole original message — text, and the content blocks
 * a recovered prompt was stored with — from every surface that offers it.
 * retryOf names the undelivered user prompt the resend supersedes, so only a
 * user-role bubble passes its id: an interrupted turn's bubble is the agent's
 * partial reply, and naming it would delete that reply on retry.
 */
export function retryHandlerFor(
  message: Message,
  onRetry: OnRetry,
): (() => void) | undefined {
  const retryWith = message.error?.retryWith;
  if (!retryWith) return undefined;
  return () => {
    onRetry(retryWith.text, retryWith.attachments, {
      ...(message.role === "user" ? { retryOf: message.id } : {}),
      ...(retryWith.blocks ? { blocks: retryWith.blocks } : {}),
    });
  };
}

export function UndeliveredNotice({
  message,
  onRetry,
  onDelete,
}: {
  message: Message;
  onRetry: OnRetry;
  onDelete: (id: string) => void;
}) {
  const { copy } = useCopy();
  const retry = retryHandlerFor(message, onRetry);
  const described = describeSendError(message.error?.message ?? "");
  const text = message.error?.retryWith?.text ?? "";
  return (
    <div
      data-testid="undelivered-marker"
      role="alert"
      className="-mx-4 mt-1 flex items-start gap-2 border-t border-danger/40 px-4 pt-2"
    >
      <Warning size={16} className="text-danger shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="text-xs text-foreground break-words">
          {described.message}
        </span>
        {described.hint && (
          <span className="text-xs text-muted-foreground break-words">
            {described.hint}
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undelivered message actions"
            data-testid="undelivered-actions"
            className="-my-1 shrink-0"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {retry && (
            <DropdownMenuItem
              data-testid="undelivered-retry-button"
              onSelect={retry}
            >
              Retry
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={text === ""}
            onSelect={() => {
              void copy(text).then((state) => {
                if (state === "failed")
                  emitToast({
                    kind: "error",
                    message: "Couldn't copy the message text.",
                  });
              });
            }}
          >
            Copy text
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger"
            onSelect={() => {
              onDelete(message.id);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
