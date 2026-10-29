import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

export function browserSessionTranscript(): Message[] {
  return [
    msg("br-m1", "user", [
      {
        kind: "text",
        text: "Open the reports page and check if the CSV export button renders correctly.",
      },
    ]),
    msg("br-m2", "assistant", [
      {
        kind: "tool",
        toolCallId: "br-t1",
        title: "Run pnpm dev",
        status: "completed",
      },
      {
        kind: "text",
        text: "Dev server is running. Opening the reports page now.",
      },
      {
        kind: "work",
        tool: "browser",
        status: "ready",
        url: "http://localhost:5173/reports",
        title: "Reports — CSV Export Preview",
      },
    ]),
    msg("br-m3", "user", [
      {
        kind: "text",
        text: "The button is there but the styles look off. Can you inspect the padding?",
      },
    ]),
    msg("br-m4", "assistant", [
      {
        kind: "text",
        text: "I see the issue — the export button has 8px padding but the design spec calls for 12px. I'll fix that and refresh.",
      },
      {
        kind: "tool",
        toolCallId: "br-t2",
        title: "Edit src/pages/reports.tsx",
        status: "completed",
      },
      {
        kind: "work",
        tool: "browser",
        status: "ready",
        url: "http://localhost:5173/reports",
        title: "Reports — Updated Export Button",
      },
    ]),
  ];
}
