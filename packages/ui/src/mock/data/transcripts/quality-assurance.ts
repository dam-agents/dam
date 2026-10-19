import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function qualityAssuranceTranscript(): TranscriptMeta {
  const m = [
    msg("qa-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Quality Assurance**. I write and run end-to-end tests for every feature branch. GitHub is connected — let me learn about your project.",
      },
    ]),

    msg("qa-m1", "assistant", [
      form({
        formId: "qa-repo",
        formKind: "input",
        label: "Which repository is the platform built from?",
        summary: "Repo: acme/platform",
      }),
    ]),
    msg("qa-m2", "user", [{ kind: "text" as const, text: "acme/platform" }]),

    msg("qa-m3", "assistant", [
      form({
        formId: "qa-read",
        formKind: "confirm",
        label: "Confirm this GitHub account can read acme/platform?",
        summary: "Read access confirmed",
      }),
    ]),
    msg("qa-m4", "user", [{ kind: "text" as const, text: "Confirmed." }]),

    msg("qa-m5", "assistant", [
      form({
        formId: "qa-model",
        formKind: "input",
        label:
          'Which model connection should I use for testing the platform? (e.g. "anthropic", "openai")',
        summary: "Model: anthropic",
      }),
    ]),
    msg("qa-m6", "user", [{ kind: "text" as const, text: "anthropic" }]),

    msg("qa-m7", "assistant", [
      form({
        formId: "qa-slack",
        formKind: "confirm",
        label:
          "Should I send test results to Slack? (Connect Slack in Configure > Connections if not already done.)",
        summary: "Slack requests: yes",
      }),
    ]),
    msg("qa-m8", "user", [{ kind: "text" as const, text: "Yes." }]),

    msg("qa-m9", "assistant", [
      form({
        formId: "qa-never-touch",
        formKind: "input",
        label:
          'Any files or directories I should never touch during tests? (comma-separated, or "none")',
        summary: "Never touch: .env, production/",
      }),
    ]),
    msg("qa-m10", "user", [
      { kind: "text" as const, text: ".env, production/" },
    ]),

    msg("qa-m11", "assistant", [
      form({
        formId: "qa-install",
        formKind: "confirm",
        label:
          "Ready for the first install? I'll clone the repo, install dependencies, and run initial tests.",
        summary: "First install approved",
      }),
    ]),
    msg("qa-m12", "user", [{ kind: "text" as const, text: "Go ahead." }]),

    msg("qa-m13", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "qa-t1",
        title: "Clone repository and run initial test suite",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "First install complete. I'll start watching for feature branches and running tests automatically.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "qa-s1",
      label: "Which repository the platform is built from",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "qa-m1",
    },
    {
      id: "qa-s2",
      label: "Confirm read access",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "qa-m3",
    },
    {
      id: "qa-s3",
      label: "Model connection",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "qa-m5",
    },
    {
      id: "qa-s4",
      label: "Slack requests",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "qa-m7",
    },
    {
      id: "qa-s5",
      label: "What never to touch",
      kind: "in-chat",
      messageEnd: 11,
      firstMessageId: "qa-m9",
    },
    {
      id: "qa-s6",
      label: "First install",
      kind: "in-chat",
      messageEnd: 13,
      firstMessageId: "qa-m11",
    },
  ];

  return { messages: m, steps };
}
