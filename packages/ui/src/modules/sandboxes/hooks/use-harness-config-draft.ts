import type { HarnessConfigChange } from "api-server-api";
import { useEffect, useState } from "react";

import { useResolvedHarnessConfig } from "../../agents/api/harness-config.js";

type Edits = Readonly<Record<string, string | null>>;

export function useHarnessConfigDraft(agentId: string | null) {
  const { values: live } = useResolvedHarnessConfig(agentId);
  const [edits, setEdits] = useState<Edits>({});
  const [submitted, setSubmitted] = useState<Edits>({});

  useEffect(() => {
    setEdits({});
    setSubmitted({});
  }, [agentId]);

  const liveValue = (field: string): string | null => {
    if (field === "model") return live?.model ?? null;
    if (field === "mode") return live?.mode ?? null;
    const v = live?.configOptions[field];
    return typeof v === "string" ? v : null;
  };

  useEffect(() => {
    setSubmitted((prev) => {
      const keep = Object.entries(prev).filter(
        ([field, value]) => value !== liveValue(field),
      );
      return keep.length === Object.keys(prev).length
        ? prev
        : Object.fromEntries(keep);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveValue reads `live`
  }, [live]);

  const settledValue = (field: string): string | null =>
    field in submitted ? submitted[field]! : liveValue(field);

  const set = (field: string, value: string | null) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  const changed = Object.entries(edits).filter(
    ([field, value]) => value !== settledValue(field),
  );

  const valueOf = (field: string): string | null =>
    field in edits ? edits[field]! : settledValue(field);

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
    commit: () => {
      setSubmitted((prev) => ({ ...prev, ...Object.fromEntries(changed) }));
      setEdits({});
    },
  };
}
