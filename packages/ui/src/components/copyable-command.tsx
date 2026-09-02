import { Checkmark, Copy } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type CopyableCommandSize = "default" | "compact";

export function CopyableCommand({
  command,
  size = "default",
  showPrompt = true,
}: {
  command: string;
  size?: CopyableCommandSize;
  showPrompt?: boolean;
}) {
  const { copy, state: copyState } = useCopy();

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted",
          size === "compact" ? "p-2" : "p-3",
        )}
      >
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-foreground">
          {showPrompt && (
            <span className="select-none text-muted-foreground">$ </span>
          )}
          {command}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy(command)}
          className="shrink-0"
        >
          {copyState === "copied" ? (
            <>
              <Checkmark size={14} /> Copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy
            </>
          )}
        </Button>
      </div>
      {copyState === "failed" && (
        <p className="mt-1.5 text-xs text-danger">
          Couldn't copy automatically — select the command and copy it manually.
        </p>
      )}
    </div>
  );
}
