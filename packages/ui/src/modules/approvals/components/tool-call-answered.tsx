import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ToolCallAnswer {
  text: string;
  denied: boolean;
}

export function ToolCallAnswered({
  answer,
  onClose,
}: {
  answer: ToolCallAnswer;
  onClose?: () => void;
}) {
  return (
    <div
      data-testid="tool-call-answered"
      className="flex min-w-0 items-center gap-2.5 text-sm text-foreground"
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          answer.denied ? "bg-muted-foreground" : "bg-success",
        )}
      />
      <span className="min-w-0 break-words">{answer.text}</span>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          tooltip="Close"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto shrink-0"
        >
          <Close size={16} />
        </Button>
      )}
    </div>
  );
}
