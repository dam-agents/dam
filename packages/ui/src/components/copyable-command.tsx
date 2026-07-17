import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

/** A one-line shell command with a Copy button. The command scrolls
 *  horizontally rather than wrapping so it always reads as a single line. */
export function CopyableCommand({ command }: { command: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // clipboard API rejects in non-secure contexts / when copy is blocked;
      // surface it so the user selects and copies manually.
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 3000);
    }
  }

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
          onClick={handleCopy}
          className="shrink-0"
        >
          {copyState === "copied" ? (
            <>
              <Check size={14} /> Copied
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
