import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function spotlightsTranscript(): TranscriptMeta {
  const m = [
    msg("sl-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Spotlights**. I run deep-dive research campaigns across your repositories — architecture analysis, dependency audits, dead-code detection, and pattern extraction.",
      },
    ]),

    // Step 1: in-chat — target repo
    msg("sl-m1", "assistant", [
      form({
        formId: "sl-repo",
        formKind: "input",
        label: "Which repository should I analyze?",
        summary: "Repo: acme/web-app",
      }),
    ]),
    msg("sl-m2", "user", [{ kind: "text" as const, text: "acme/web-app" }]),

    // Step 2: in-chat — optimization goal
    msg("sl-m3", "assistant", [
      form({
        formId: "sl-goal",
        formKind: "input",
        label:
          'What\'s the optimization goal? (e.g. "reduce bundle size", "find dead code", "map architecture")',
        summary: "Goal: map architecture and find dead code",
      }),
    ]),
    msg("sl-m4", "user", [
      { kind: "text" as const, text: "Map architecture and find dead code." },
    ]),

    // Step 3: in-chat — modules to include
    msg("sl-m5", "assistant", [
      form({
        formId: "sl-modules",
        formKind: "input",
        label: 'Which modules should I include? (comma-separated, or "all")',
        summary: "Modules: src/api, src/core, src/ui",
      }),
    ]),
    msg("sl-m6", "user", [
      { kind: "text" as const, text: "src/api, src/core, src/ui" },
    ]),

    // Step 4: in-chat — approve first run
    msg("sl-m7", "assistant", [
      form({
        formId: "sl-approve",
        formKind: "confirm",
        label:
          "Ready to start the first run? This costs about $15–20 and takes 20–45 minutes per module (3 modules = roughly $45–60, 1–2 hours).",
        summary: "First run approved",
      }),
    ]),
    msg("sl-m8", "user", [{ kind: "text" as const, text: "Go ahead." }]),

    // Agent starts
    msg("sl-m9", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "sl-t1",
        title: "Queue initial research campaign",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "Campaign queued. I'll work through the three modules and post findings as structured reports. You can queue additional campaigns anytime.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "sl-s1",
      label: "Target repository",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "sl-m1",
    },
    {
      id: "sl-s2",
      label: "Optimization goal",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "sl-m3",
    },
    {
      id: "sl-s3",
      label: "Modules to include",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "sl-m5",
    },
    {
      id: "sl-s4",
      label: "Approve the first run",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "sl-m7",
    },
  ];

  return { messages: m, steps };
}
