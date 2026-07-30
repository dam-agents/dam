import { Checkmark, Copy } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/use-copy";

/** A one-line shell command with a Copy button. The command scrolls
 *  horizontally rather than wrapping so it always reads as a single line. */
export function CopyableCommand({ command }: { command: string }) {
  const { copy, state: copyState } = useCopy();

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-foreground">
          <span className="select-none text-muted-foreground">$ </span>
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
        <p className="mt-1.5 text-[12px] text-danger">
          Couldn't copy automatically — select the command and copy it manually.
        </p>
      )}
    </div>
  );
}
