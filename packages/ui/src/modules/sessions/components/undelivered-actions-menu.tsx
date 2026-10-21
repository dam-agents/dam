import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { useCopy } from "@/hooks/use-copy";

import { emitToast } from "../../../lib/toast.js";
import type { Message } from "../../../types.js";

interface Props {
  message: Message;
  onRetry?: () => void;
  onDelete: (id: string) => void;
}

export function UndeliveredActionsMenu({ message, onRetry, onDelete }: Props) {
  const { copy } = useCopy();
  const text = message.error?.retryWith?.text ?? "";

  function handleCopy() {
    void copy(text).then((state) => {
      if (state === "failed")
        emitToast({
          kind: "error",
          message: "Couldn't copy the message text.",
        });
    });
  }

  return (
    <RowActionsMenu
      label="Undelivered message actions"
      testId="undelivered-actions"
      className="-my-1"
    >
      {onRetry && (
        <DropdownMenuItem
          data-testid="undelivered-retry-button"
          onSelect={onRetry}
        >
          Retry
        </DropdownMenuItem>
      )}
      <DropdownMenuItem disabled={text === ""} onSelect={handleCopy}>
        Copy text
      </DropdownMenuItem>
      <DropdownMenuItem tone="danger" onSelect={() => onDelete(message.id)}>
        Delete
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
