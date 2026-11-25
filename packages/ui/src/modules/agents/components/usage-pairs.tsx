import { Tooltip } from "@/components/ui/tooltip";

import { formatBytes } from "../../../lib/format-size.js";
import type { AgentUsage } from "../utils/sandbox-subtitle.js";

export function UsagePairs({ usage }: { usage: AgentUsage }) {
  return (
    <>
      {usage.memoryBytes !== null && (
        <UsagePair
          word="memory"
          what="Memory used by this agent"
          bytes={usage.memoryBytes}
        />
      )}
      {usage.storageBytes !== null && (
        <UsagePair
          word="storage"
          what="Storage used by this agent"
          bytes={usage.storageBytes}
        />
      )}
    </>
  );
}

function UsagePair({
  word,
  what,
  bytes,
}: {
  word: string;
  what: string;
  bytes: number;
}) {
  const amount = formatBytes(bytes);
  return (
    <Tooltip side="top" content={what}>
      <span
        tabIndex={0}
        aria-label={`${what}: ${amount}`}
        className="inline-flex items-center rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {amount} {word}
      </span>
    </Tooltip>
  );
}
