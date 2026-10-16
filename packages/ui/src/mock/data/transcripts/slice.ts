import type { FormPart, Message } from "../../../types.js";

import type { TranscriptMeta } from "./types.js";

export function sliceTranscriptForStep(
  meta: TranscriptMeta,
  stepIndex: number,
): Message[] {
  if (meta.steps.length === 0) return [...meta.messages];

  const pastEnd = stepIndex >= meta.steps.length;
  const end = pastEnd
    ? meta.messages.length
    : meta.steps[stepIndex]!.messageEnd;

  const sliced = meta.messages.slice(0, end).map((m) => ({
    ...m,
    parts: m.parts.map((p) => (p.kind === "form" ? { ...p } : p)),
  }));

  const prevEnd = stepIndex > 0
    ? meta.steps[Math.min(stepIndex - 1, meta.steps.length - 1)]!.messageEnd
    : 0;

  for (const m of sliced) {
    for (const p of m.parts) {
      if (p.kind !== "form") continue;
      const fp = p as FormPart;
      const msgIdx = meta.messages.indexOf(
        meta.messages.find((orig) => orig.id === m.id)!,
      );
      if (pastEnd || msgIdx < prevEnd) {
        fp.answered = true;
      }
    }
  }

  return sliced;
}

export function sliceTranscriptForPhase(
  meta: TranscriptMeta,
  phase: "just-created" | "halfway" | "done",
): Message[] {
  if (meta.steps.length === 0) return [...meta.messages];
  const stepMap: Record<string, number> = {
    "just-created": 0,
    halfway: Math.min(Math.floor(meta.steps.length / 2), meta.steps.length),
    done: meta.steps.length,
  };
  return sliceTranscriptForStep(meta, stepMap[phase]!);
}
