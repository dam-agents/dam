import { form, msg } from "./helpers.js";
import type { TranscriptMeta, TranscriptStep } from "./types.js";

export function softwareDeveloperTranscript(): TranscriptMeta {
  const m = [
    msg("sd-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Software Developer**. I pick up issues, write code, open PRs, and iterate on review feedback. GitHub is connected — let me learn how you want me to work.",
      },
    ]),

    msg("sd-m1", "assistant", [
      form({
        formId: "sd-backup",
        formKind: "input",
        label: "Where should I back up my work?",
        summary: "Backup: local-only",
      }),
    ]),
    msg("sd-m2", "user", [{ kind: "text" as const, text: "Local-only." }]),

    msg("sd-m3", "assistant", [
      form({
        formId: "sd-repo",
        formKind: "input",
        label: "Which repository should I work on?",
        summary: "Repo: acme/web-app",
      }),
    ]),
    msg("sd-m4", "user", [{ kind: "text" as const, text: "acme/web-app" }]),

    msg("sd-m5", "assistant", [
      form({
        formId: "sd-watch",
        formKind: "select",
        label:
          "Should I watch GitHub for new issues, or only work when you ask?",
        options: [
          {
            id: "watch",
            label: "Watch GitHub — pick up assigned issues automatically",
          },
          { id: "ask", label: "Only when asked — I wait for you" },
        ],
        summary: "Mode: watch GitHub",
      }),
    ]),
    msg("sd-m6", "user", [{ kind: "text" as const, text: "Watch GitHub." }]),

    msg("sd-m7", "assistant", [
      form({
        formId: "sd-labels",
        formKind: "input",
        label:
          'Which labels should I apply to PRs I open? (comma-separated, or "none")',
        summary: "Labels: bot, auto-pr",
      }),
    ]),
    msg("sd-m8", "user", [{ kind: "text" as const, text: "bot, auto-pr" }]),

    msg("sd-m9", "assistant", [
      form({
        formId: "sd-build",
        formKind: "input",
        label:
          'How do I build, check, and test this project? (e.g. "pnpm build && pnpm test")',
        summary: "Build: pnpm build && pnpm test",
      }),
    ]),
    msg("sd-m10", "user", [
      { kind: "text" as const, text: "pnpm build && pnpm test" },
    ]),

    msg("sd-m11", "assistant", [
      form({
        formId: "sd-push",
        formKind: "confirm",
        label:
          "Confirm this GitHub account can push branches and open pull requests on acme/web-app?",
        summary: "Push access confirmed",
      }),
    ]),
    msg("sd-m12", "user", [{ kind: "text" as const, text: "Confirmed." }]),

    msg("sd-m13", "assistant", [
      form({
        formId: "sd-platform",
        formKind: "input",
        label:
          "What's the platform address where I'm running? (so I can link back in PR descriptions)",
        summary: "Platform: platform.acme.dev",
      }),
    ]),
    msg("sd-m14", "user", [
      { kind: "text" as const, text: "platform.acme.dev" },
    ]),

    msg("sd-m15", "assistant", [
      form({
        formId: "sd-schedules",
        formKind: "confirm",
        label:
          "I have default schedules (issue scan every 5 min, PR feedback every 10 min). Want to adjust them now, or use defaults?",
        summary: "Schedules: defaults",
      }),
    ]),
    msg("sd-m16", "user", [
      { kind: "text" as const, text: "Defaults are fine." },
    ]),

    msg("sd-m17", "assistant", [
      form({
        formId: "sd-slack",
        formKind: "confirm",
        label:
          "Should I post updates to Slack? (You can connect Slack later in Configure > Connections.)",
        summary: "Slack updates: yes, later",
      }),
    ]),
    msg("sd-m18", "user", [
      { kind: "text" as const, text: "Yes, once Slack is connected." },
    ]),

    msg("sd-m19", "assistant", [
      form({
        formId: "sd-never-touch",
        formKind: "input",
        label:
          'Any files or directories I should never touch? (comma-separated, or "none")',
        summary: "Never touch: .env, deploy/",
      }),
    ]),
    msg("sd-m20", "user", [{ kind: "text" as const, text: ".env, deploy/" }]),

    msg("sd-m21", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "sd-t1",
        title: "Save configuration and enable schedules",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "All set. I'll start watching **acme/web-app** for assigned issues. You can change any of these settings later.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "sd-s1",
      label: "Where work is backed up",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "sd-m1",
    },
    {
      id: "sd-s2",
      label: "Which repository",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "sd-m3",
    },
    {
      id: "sd-s3",
      label: "Watch GitHub or only when asked",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "sd-m5",
    },
    {
      id: "sd-s4",
      label: "Labels",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "sd-m7",
    },
    {
      id: "sd-s5",
      label: "How to build, check and test",
      kind: "in-chat",
      messageEnd: 11,
      firstMessageId: "sd-m9",
    },
    {
      id: "sd-s6",
      label: "Confirm push and PR access",
      kind: "in-chat",
      messageEnd: 13,
      firstMessageId: "sd-m11",
    },
    {
      id: "sd-s7",
      label: "Platform address",
      kind: "in-chat",
      messageEnd: 15,
      firstMessageId: "sd-m13",
    },
    {
      id: "sd-s8",
      label: "Schedules",
      kind: "in-chat",
      messageEnd: 17,
      firstMessageId: "sd-m15",
    },
    {
      id: "sd-s9",
      label: "Slack updates",
      kind: "in-chat",
      messageEnd: 19,
      firstMessageId: "sd-m17",
    },
    {
      id: "sd-s10",
      label: "What never to touch",
      kind: "in-chat",
      messageEnd: 21,
      firstMessageId: "sd-m19",
    },
  ];

  return { messages: m, steps };
}
