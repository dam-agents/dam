import { WarningAlt } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { formatTimestamp, timeAgo } from "@/lib/format-time";

/** Dates the values a stopped sandbox is showing, so they can't be mistaken for
 *  live state. */
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

/**
 * The saved model is absent from the model list the provider offered when the
 * snapshot was taken, so a new session would fail to start.
 *
 * Names the model and not the provider on purpose: discovery resolves a base URL
 * out of materialized env, and mapping that back to a connection's display name
 * would be a guess.
 */
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

/** The snapshot's own model when it is missing from the list captured beside it,
 *  else null. Both come from one pod read, so the comparison stays
 *  self-consistent however old the snapshot is; a null list means discovery
 *  never ran, which is not evidence of anything. */
export function unavailableModel(values: {
  model: string | null;
  /** Absent when the read couldn't resolve a list, null when the harness has no
   *  discovery — neither is evidence, so both withhold the verdict. */
  availableModels?: { value: string }[] | null;
}): string | null {
  const { model, availableModels } = values;
  if (!model || !availableModels) return null;
  return availableModels.some((m) => m.value === model) ? null : model;
}
