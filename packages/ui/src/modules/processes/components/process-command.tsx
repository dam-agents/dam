import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { TruncateStart } from "../../../components/truncate-start.js";

export function ProcessCommand({
  command,
  title = command,
  muted = false,
}: {
  command: string;
  title?: string;
  muted?: boolean;
}) {
  return (
    <Tooltip
      content={<span className="font-mono break-all">{command}</span>}
      side="right"
    >
      <span className="flex min-w-0 flex-1">
        <TruncateStart
          className={cn(
            "min-w-0 font-mono text-xs",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </TruncateStart>
      </span>
    </Tooltip>
  );
}
