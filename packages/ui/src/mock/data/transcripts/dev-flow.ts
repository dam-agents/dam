import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

export function devFlowTranscript(): Message[] {
  return [
    msg("df-1", "user", [
      {
        kind: "text",
        text: "Add a CSV export button to the reports page in web-app, then run it so I can try it.",
      },
    ]),
    msg("df-2", "assistant", [
      {
        kind: "tool",
        toolCallId: "df-t1",
        title: "Read src/pages/reports.tsx",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "df-t2",
        title: "Edit src/pages/reports.tsx",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "df-t3",
        title: "Create src/lib/csv.ts",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "df-t4",
        title: "Run pnpm test",
        status: "completed",
      },
      {
        kind: "text",
        text: "Done. The reports page now has an **Export CSV** button, and the tests pass.",
      },
      {
        kind: "work",
        tool: "artifact",
        title: "Landing page",
        artifactKind: "HTML",
        accessLabel: "Your team",
        expiresAt: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      {
        kind: "work",
        tool: "changes",
        files: [
          { path: "src/pages/reports.tsx", insertions: 18, deletions: 4 },
          { path: "src/lib/csv.ts", insertions: 28, deletions: 0 },
          {
            path: "src/lib/__tests__/csv.test.ts",
            insertions: 22,
            deletions: 0,
          },
        ],
        summary:
          "Added CSV export button to reports page with a reusable csv utility.",
      },
      {
        kind: "tool",
        toolCallId: "df-t5",
        title: "Run pnpm dev",
        status: "completed",
      },
      {
        kind: "text",
        text: "The dev server is running. Try it here:",
      },
      {
        kind: "work",
        tool: "process",
        command: "pnpm dev",
        exitCode: 0,
        logLines: [
          "  VITE v5.4.2  ready in 420 ms",
          "",
          "  ➜  Local:   http://localhost:5173/",
          "  ➜  Network: use --host to expose",
        ],
      },
      {
        kind: "work",
        tool: "browser",
        status: "ready",
        url: "http://localhost:5173/reports",
        title: "Reports — CSV Export Preview",
      },
    ]),
    msg("df-3", "user", [
      {
        kind: "text",
        text: "Looks good. Can you give me a link I can send to my team so they can try it too?",
      },
    ]),
    msg("df-4", "assistant", [
      {
        kind: "tool",
        toolCallId: "df-t6",
        title: "Create environment csv-export-preview",
        status: "completed",
      },
      {
        kind: "text",
        text: "I made a preview environment from this branch. Your team can open it for the next 3 days.",
      },
      {
        kind: "work",
        tool: "environment",
        status: "running",
        name: "csv-export-preview",
        url: "https://csv-export-preview.envs.example.com",
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        accessLabel: "Your team",
        items: [
          { label: "Branch", value: "feat/csv-export" },
          { label: "Region", value: "us-east-1" },
        ],
      },
    ]),
  ];
}
