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
        kind: "text",
        text: "I'll add a CSV export button to the reports page. Let me check the current structure first.",
      },
      {
        kind: "work",
        tool: "environment",
        items: [
          { label: "Runtime", value: "Node 20.11" },
          { label: "Framework", value: "React 18.3" },
          { label: "TypeScript", value: "5.4.2" },
          { label: "Package Manager", value: "pnpm 9.1" },
        ],
      },
    ]),
    msg("df-3", "assistant", [
      {
        kind: "text",
        text: "Adding the export button and a CSV utility module.",
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
    ]),
    msg("df-4", "assistant", [
      {
        kind: "text",
        text: "Let me verify everything compiles and the tests pass.",
      },
      {
        kind: "work",
        tool: "process",
        command: "pnpm test",
        exitCode: 0,
        logLines: [
          "$ vitest run",
          " ✓ src/lib/__tests__/csv.test.ts (3 tests) 45ms",
          "   ✓ exports rows as CSV string",
          "   ✓ escapes commas and quotes",
          "   ✓ handles empty data",
          "",
          " Test Files  1 passed (1)",
          " Tests       3 passed (3)",
          " Duration    0.84s",
        ],
      },
    ]),
    msg("df-5", "assistant", [
      {
        kind: "text",
        text: "Done. The reports page now has an **Export CSV** button, and the tests pass.",
      },
    ]),
    msg("df-6", "assistant", [
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
        url: "http://localhost:5173/reports",
        title: "Open localhost:5173/reports",
      },
    ]),
    msg("df-7", "user", [
      {
        kind: "text",
        text: "Looks good. Can you give me a link I can send to my team so they can try it too?",
      },
    ]),
    msg("df-8", "assistant", [
      {
        kind: "text",
        text: "I made a preview environment from this branch. Anyone with the link can open it for the next 3 days.",
      },
      {
        kind: "work",
        tool: "environment",
        items: [
          { label: "Name", value: "csv-export-preview" },
          { label: "Status", value: "Running" },
          { label: "Expires", value: "in 3 days" },
        ],
      },
    ]),
  ];
}
