import { msg } from "./helpers.js";
import type { TranscriptMeta, TranscriptStep } from "./types.js";

export function kSearchTranscript(): TranscriptMeta {
  const m = [
    msg("ks-m0", "assistant", [
      {
        kind: "text" as const,
        text: "**K-Search** needs cloud GPUs to evaluate kernels. Open **Configure > Connections** and connect Modal to get started.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "ks-s1",
      label: "Connect Modal",
      kind: "outside-chat",
      messageEnd: 1,
      firstMessageId: "ks-m0",
      pointer: { target: "Configure > Connections", exists: true },
    },
  ];

  return { messages: m, steps };
}
