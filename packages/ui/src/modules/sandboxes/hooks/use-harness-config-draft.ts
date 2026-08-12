import type { HarnessConfigChange } from "api-server-api";
import { useEffect, useState } from "react";

import { useResolvedHarnessConfig } from "../../agents/api/harness-config.js";

/** A picked value per option group id — `model`, `mode`, or a config option's
 *  own id. Null is the explicit "not set" choice, which unsets the field. */
type Edits = Readonly<Record<string, string | null>>;

/**
 * Staging buffer for the sandbox settings page's Model settings section.
 *
 * The pickers used to apply on change, which made this the one section on the
 * page that saved itself while every other field waited for Submit changes.
 * Edits now stage here: Submit commits them, leaving discards them, and
 * switching sandbox resets them — the same contract as
 * {@link useStagedNetworkAccess}.
 *
 * Chat's copy of the panel still applies on change. There is no Submit in a
 * conversation, and a staged edit nobody commits would be a lie about what the
 * next turn runs.
 */
export function useHarnessConfigDraft(agentId: string | null) {
  const { values: live } = useResolvedHarnessConfig(agentId);
  const [edits, setEdits] = useState<Edits>({});
  // What a successful Submit sent. The values the sandbox reports only catch up
  // once the change reaches the pod and the snapshot is re-read, so without this
  // the pickers would snap back to the old values the moment we stopped
  // treating the edits as pending.
  const [submitted, setSubmitted] = useState<Edits>({});

  // Switching sandbox discards anything staged for the previous one.
  useEffect(() => {
    setEdits({});
    setSubmitted({});
  }, [agentId]);

  const settledValue = (field: string): string | null => {
    if (field in submitted) return submitted[field]!;
    if (field === "model") return live?.model ?? null;
    if (field === "mode") return live?.mode ?? null;
    const v = live?.configOptions[field];
    return typeof v === "string" ? v : null;
  };

  const set = (field: string, value: string | null) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  /** Only the edits that still differ from what is already saved, so picking a
   *  value and then picking the original back is not a change. */
  const changed = Object.entries(edits).filter(
    ([field, value]) => value !== settledValue(field),
  );

  /** The staged value where one exists, else what is saved — what the pickers
   *  display. Membership, not `??`: a deliberate "not set" is a null entry. */
  const valueOf = (field: string): string | null =>
    field in edits ? edits[field]! : settledValue(field);

  /** One apply carries the whole batch: the schema takes model, mode, config
   *  options, and unsets together. */
  const buildInput = (
    id: string,
  ): HarnessConfigChange & { agentId: string } => {
    const configOptions: Record<string, string> = {};
    const unset: string[] = [];
    let model: string | undefined;
    let mode: string | undefined;
    for (const [field, value] of changed) {
      if (value === null) unset.push(field);
      else if (field === "model") model = value;
      else if (field === "mode") mode = value;
      else configOptions[field] = value;
    }
    return {
      agentId: id,
      ...(model ? { model } : {}),
      ...(mode ? { mode } : {}),
      ...(Object.keys(configOptions).length > 0 ? { configOptions } : {}),
      ...(unset.length > 0 ? { unset } : {}),
    };
  };

  return {
    set,
    valueOf,
    buildInput,
    dirty: changed.length > 0,
    /** Adopt what was just sent as saved. Keeps showing it while the sandbox
     *  catches up, without reading as unsaved. */
    commit: () => setSubmitted((prev) => ({ ...prev, ...edits })),
  };
}
