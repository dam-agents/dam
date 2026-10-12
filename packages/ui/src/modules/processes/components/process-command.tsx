import { Tooltip } from "@/components/ui/tooltip";

import { TruncateStart } from "../../../components/truncate-start.js";

export function ProcessCommand({ command }: { command: string }) {
  return (
    <Tooltip
      content={<span className="font-mono break-all">{command}</span>}
      side="right"
    >
      <span className="flex min-w-0 flex-1">
        <TruncateStart className="min-w-0 font-mono text-xs text-foreground">
          {command}
        </TruncateStart>
      </span>
    </Tooltip>
  );
}
