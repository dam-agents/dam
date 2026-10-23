import type { CarbonIconType } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

import { formatBytes } from "../../../lib/format-size.js";
import { RESOURCE_ICON } from "../../budgets/lib/resource-icons.js";
import type { AgentUsage } from "../utils/sandbox-subtitle.js";

export function UsagePairs({ usage }: { usage: AgentUsage }) {
  return (
    <>
      {usage.memoryBytes !== null && (
        <UsagePair
          icon={RESOURCE_ICON.memory}
          what="Memory used by this agent"
          bytes={usage.memoryBytes}
        />
      )}
      {usage.storageBytes !== null && (
        <UsagePair
          icon={RESOURCE_ICON.storage}
          what="Storage used by this agent"
          bytes={usage.storageBytes}
        />
      )}
    </>
  );
}

function UsagePair({
  icon: Icon,
  what,
  bytes,
}: {
  icon: CarbonIconType;
  what: string;
  bytes: number;
}) {
  const amount = formatBytes(bytes);
  return (
    <Tooltip side="top" content={what}>
      <span
        tabIndex={0}
        aria-label={`${what}: ${amount}`}
        className="inline-flex items-center gap-1 rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon size={14} aria-hidden className="shrink-0" />
        {amount}
      </span>
    </Tooltip>
  );
}
