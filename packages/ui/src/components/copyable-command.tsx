import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";

export function CopyableCommand({ command }: { command: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
          <span className="select-none text-muted-foreground">$ </span>
          {command}
        </code>
        <CopyButton
          value={command}
          label="Copy command"
          variant="outline"
          size="icon-sm"
          onResult={(state) => setFailed(state === "failed")}
        />
      </div>
      {failed && (
        <p className="mt-1.5 text-xs text-danger">
          Couldn't copy automatically — select the command and copy it manually.
        </p>
      )}
    </div>
  );
}
