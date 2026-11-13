import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

export function gitChangesSessionTranscript(): Message[] {
  return [
    msg("gc-m1", "user", [
      {
        kind: "text",
        text: "Fix the broken CSV export in the reports page. The column headers aren't being escaped properly.",
      },
    ]),
    msg("gc-m2", "assistant", [
      {
        kind: "tool",
        toolCallId: "gc-t1",
        title: "Read src/reports/csv-export.ts",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "gc-t2",
        title: "Grep escapeField across codebase",
        status: "completed",
      },
      {
        kind: "text",
        text: "Found the bug — `buildCsvRow` passes raw values through without calling `escapeField`. Fields containing commas or quotes break the CSV structure. I'll fix the export function and add tests.",
      },
    ]),
    msg("gc-m3", "assistant", [
      {
        kind: "tool",
        toolCallId: "gc-t3",
        title: "Edit src/reports/csv-export.ts",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "gc-t4",
        title: "Edit src/reports/escape.ts",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "gc-t5",
        title: "Edit src/reports/__tests__/escape.test.ts",
        status: "completed",
      },
      {
        kind: "text",
        text: "Fixed `buildCsvRow` to call `escapeField` on every value, updated the escape function to handle commas, quotes and newlines, and added test coverage.",
      },
      {
        kind: "work",
        tool: "changes",
        files: [
          { path: "src/reports/csv-export.ts", insertions: 14, deletions: 4 },
          { path: "src/reports/escape.ts", insertions: 8, deletions: 2 },
          {
            path: "src/reports/__tests__/escape.test.ts",
            insertions: 12,
            deletions: 0,
          },
        ],
        summary: "platform · fix/csv-export",
        repository: "platform",
        branch: "fix/csv-export",
      },
    ]),
    msg("gc-m4", "assistant", [
      {
        kind: "tool",
        toolCallId: "gc-t6",
        title: "Run git commit -m 'fix: escape CSV fields properly'",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "gc-t7",
        title: "Run gh pr create --title 'Fix CSV field escaping'",
        status: "completed",
      },
      {
        kind: "text",
        text: "Committed the fix and opened a pull request. The tests pass and the CSV output now handles special characters correctly.",
      },
      {
        kind: "work",
        tool: "changes",
        files: [
          { path: "src/reports/csv-export.ts", insertions: 14, deletions: 4 },
          { path: "src/reports/escape.ts", insertions: 8, deletions: 2 },
          {
            path: "src/reports/__tests__/escape.test.ts",
            insertions: 12,
            deletions: 0,
          },
        ],
        summary: "platform · fix/csv-export",
        repository: "platform",
        branch: "fix/csv-export",
        pullRequest: {
          number: 142,
          url: "https://github.com/acme/platform/pull/142",
          state: "pending",
        },
      },
    ]),
  ];
}
