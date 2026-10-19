import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function codeReviewerTranscript(): TranscriptMeta {
  const m = [
    msg("cg-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Code Reviewer**. I review every open pull request and nudge reviewers who go quiet. GitHub is connected — let's get the rest set up.",
      },
    ]),

    // Step 1: in-chat — backup repository
    msg("cg-m1", "assistant", [
      form({
        formId: "cg-backup",
        formKind: "input",
        label:
          'Where should I back up review history? Enter a repo name, or type "local-only" to skip.',
        summary: "Backup: local-only",
      }),
    ]),
    msg("cg-m2", "user", [
      { kind: "text" as const, text: "Local-only for now." },
    ]),

    // Step 2: in-chat — repository to review
    msg("cg-m3", "assistant", [
      form({
        formId: "cg-repo",
        formKind: "input",
        label: "Which repository should I review?",
        summary: "Repo: acme/web-app",
      }),
    ]),
    msg("cg-m4", "user", [{ kind: "text" as const, text: "acme/web-app" }]),

    // Step 3: in-chat — name to sign reviews with
    msg("cg-m5", "assistant", [
      form({
        formId: "cg-name",
        formKind: "input",
        label: "What name should I sign review comments with?",
        summary: "Review name: Code Guardian",
      }),
    ]),
    msg("cg-m6", "user", [{ kind: "text" as const, text: "Code Guardian" }]),

    // Step 4: in-chat — labels
    msg("cg-m7", "assistant", [
      form({
        formId: "cg-labels",
        formKind: "input",
        label:
          'Which labels should I apply to reviewed PRs? (comma-separated, or "none")',
        summary: "Labels: reviewed, needs-changes",
      }),
    ]),
    msg("cg-m8", "user", [
      { kind: "text" as const, text: "reviewed, needs-changes" },
    ]),

    // Step 5: in-chat — Slack notifications
    msg("cg-m9", "assistant", [
      form({
        formId: "cg-slack",
        formKind: "confirm",
        label:
          "Should I send review notifications to Slack? (You can connect Slack later in Configure > Connections.)",
        summary: "Slack notifications: yes",
      }),
    ]),
    msg("cg-m10", "user", [
      { kind: "text" as const, text: "Yes, once Slack is connected." },
    ]),

    // Step 6: in-chat — review hours
    msg("cg-m11", "assistant", [
      form({
        formId: "cg-hours",
        formKind: "input",
        label:
          'When should I review? (e.g. "business hours", "anytime", "Mon-Fri 9-17 AEST")',
        summary: "Review hours: business hours AEST",
      }),
    ]),
    msg("cg-m12", "user", [
      { kind: "text" as const, text: "Business hours AEST." },
    ]),

    // Agent reconciles
    msg("cg-m13", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "cg-t1",
        title: "Save configuration and enable schedules",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "All set. I'll start watching **acme/web-app** for pull requests during business hours. You can change any of these settings later from the session menu.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "cg-s1",
      label: "Backup repository",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "cg-m1",
    },
    {
      id: "cg-s2",
      label: "Repository to review",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "cg-m3",
    },
    {
      id: "cg-s3",
      label: "Name to sign reviews with",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "cg-m5",
    },
    {
      id: "cg-s4",
      label: "Labels",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "cg-m7",
    },
    {
      id: "cg-s5",
      label: "Slack notifications",
      kind: "in-chat",
      messageEnd: 11,
      firstMessageId: "cg-m9",
    },
    {
      id: "cg-s6",
      label: "Review hours",
      kind: "in-chat",
      messageEnd: 13,
      firstMessageId: "cg-m11",
    },
  ];

  return { messages: m, steps };
}
