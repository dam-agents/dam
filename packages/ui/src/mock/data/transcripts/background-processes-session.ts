import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";

export function backgroundProcessesSessionTranscript(): Message[] {
  return [
    msg("bp-m1", "user", [
      {
        kind: "text",
        text: "Start the dev server and run the test suite in the background while I work on other things.",
      },
    ]),
    msg("bp-m2", "assistant", [
      {
        kind: "tool",
        toolCallId: "bp-t1",
        title: "Run npm run dev",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "bp-t2",
        title: "Run npm test -- --watch",
        status: "completed",
      },
      {
        kind: "text",
        text: "Started both processes. The dev server is running at `localhost:3000` and the test watcher is picking up changes.",
      },
      {
        kind: "work",
        tool: "process",
        status: "running-awake",
        command: "npm run dev",
        processKind: "detached",
      },
      {
        kind: "work",
        tool: "process",
        status: "running-hibernates",
        command: "npm test -- --watch",
        processKind: "harness-task",
      },
    ]),
    msg("bp-m3", "assistant", [
      {
        kind: "text",
        text: "The test suite finished — 2 tests failed in `auth.test.ts`. The dev server is still running.",
      },
      {
        kind: "work",
        tool: "process",
        status: "exited",
        command: "npm test -- --watch",
        exitCode: 1,
        processKind: "harness-task",
      },
    ]),
    msg("bp-m4", "user", [
      {
        kind: "text",
        text: "Stop the dev server, I'm done for now.",
      },
    ]),
    msg("bp-m5", "assistant", [
      {
        kind: "tool",
        toolCallId: "bp-t3",
        title: "Stop process npm run dev",
        status: "completed",
      },
      {
        kind: "text",
        text: "Dev server stopped.",
      },
      {
        kind: "work",
        tool: "process",
        status: "stopped",
        command: "npm run dev",
        processKind: "detached",
      },
    ]),
  ];
}
