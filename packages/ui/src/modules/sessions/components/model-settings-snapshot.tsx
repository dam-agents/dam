import { WarningAlt } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { formatTimestamp, timeAgo } from "@/lib/format-time";

export function SnapshotNote({ capturedAt }: { capturedAt: string }) {
  return (
    <p className="pb-3 text-[11px] leading-snug text-muted-foreground">
      Last known configuration, captured{" "}
      <span title={formatTimestamp(capturedAt)}>{timeAgo(capturedAt)}</span> —
      the sandbox is stopped, so this is a snapshot rather than live state.
      Start the sandbox to change these settings.
    </p>
  );
}

export function StaleModelCallout({ model }: { model: string }) {
  return (
    <Callout tone="warning" size="sm" className="mb-3 flex gap-2.5">
      <WarningAlt size={16} className="mt-px shrink-0 text-warning" />
      <p className="text-sm leading-snug">
        The saved model isn&rsquo;t offered by the provider this sandbox last
        reached. It&rsquo;s set to{" "}
        <span className="font-mono text-[13px]">{model}</span>. Chatting will
        fail until it&rsquo;s changed.
      </p>
    </Callout>
  );
}

export function unavailableModel(values: {
  model: string | null;
  availableModels?: { value: string }[] | null;
}): string | null {
  const { model, availableModels } = values;
  if (!model || !availableModels) return null;
  return availableModels.some((m) => m.value === model) ? null : model;
}
