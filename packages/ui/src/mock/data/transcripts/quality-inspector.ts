import { form, msg } from "./helpers.js";
import type { TranscriptMeta, TranscriptStep } from "./types.js";

export function qualityInspectorTranscript(): TranscriptMeta {
  const m = [
    msg("qi-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Quality Inspector**. I test every issue, run nightly regressions, and benchmark your product. GitHub is connected — let's configure the rest.",
      },
    ]),

    // Step 1: outside-chat — product profile (opens Configure)
    msg("qi-m1", "assistant", [
      {
        kind: "text" as const,
        text: "Open **Configure > Skills** and add the **Product Profile** so I know what I'm testing — the product name, URL, and key user flows.",
      },
    ]),

    // Step 2: in-chat — backend
    msg("qi-m2", "assistant", [
      form({
        formId: "qi-backend",
        formKind: "input",
        label:
          'What backend stack does the product use? (e.g. "Node + Postgres", "Rails + Redis")',
        summary: "Backend: Node + Postgres",
      }),
    ]),
    msg("qi-m3", "user", [{ kind: "text" as const, text: "Node + Postgres" }]),

    // Step 3: in-chat — target repository
    msg("qi-m4", "assistant", [
      form({
        formId: "qi-repo",
        formKind: "input",
        label: "Target repository for tests?",
        summary: "Repo: acme/platform",
      }),
    ]),
    msg("qi-m5", "user", [{ kind: "text" as const, text: "acme/platform" }]),

    // Step 4: outside-chat — egress rules (opens Configure)
    msg("qi-m6", "assistant", [
      {
        kind: "text" as const,
        text: "Open **Configure > Agent Setup** and set your egress rules. I need network access to reach your staging environment.",
      },
    ]),

    // Step 5: in-chat — issue comments
    msg("qi-m7", "assistant", [
      form({
        formId: "qi-comments",
        formKind: "confirm",
        label: "Should I comment on issues with test results?",
        summary: "Issue comments: yes",
      }),
    ]),
    msg("qi-m8", "user", [{ kind: "text" as const, text: "Yes" }]),

    // Step 6: in-chat — profile settings
    msg("qi-m9", "assistant", [
      form({
        formId: "qi-profile",
        formKind: "input",
        label: "Test profile name (shown in reports)?",
        summary: 'Profile: "QI Bot"',
      }),
    ]),
    msg("qi-m10", "user", [{ kind: "text" as const, text: "QI Bot" }]),

    // Step 7: in-chat — model credential
    msg("qi-m11", "assistant", [
      form({
        formId: "qi-model",
        formKind: "input",
        label:
          'Which model connection should I use for generating test scenarios? (e.g. "anthropic", "openai")',
        summary: "Model: anthropic",
      }),
    ]),
    msg("qi-m12", "user", [{ kind: "text" as const, text: "anthropic" }]),

    // Step 8: in-chat — work backup
    msg("qi-m13", "assistant", [
      form({
        formId: "qi-backup",
        formKind: "confirm",
        label: "Back up test results to GitHub?",
        summary: "Work backup: GitHub",
      }),
    ]),
    msg("qi-m14", "user", [
      { kind: "text" as const, text: "Yes, GitHub is fine." },
    ]),

    // Wrap-up
    msg("qi-m15", "assistant", [
      {
        kind: "text" as const,
        text: "All set. I'll start watching issues on **acme/platform** and testing them as they come in. The first hourly run kicks off shortly.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "qi-s1",
      label: "Product profile",
      kind: "outside-chat",
      messageEnd: 2,
      firstMessageId: "qi-m1",
      pointer: { target: "Configure > Skills", exists: true },
    },
    {
      id: "qi-s2",
      label: "Backend",
      kind: "in-chat",
      messageEnd: 4,
      firstMessageId: "qi-m2",
    },
    {
      id: "qi-s3",
      label: "Target repository",
      kind: "in-chat",
      messageEnd: 6,
      firstMessageId: "qi-m4",
    },
    {
      id: "qi-s4",
      label: "Egress rules",
      kind: "outside-chat",
      messageEnd: 7,
      firstMessageId: "qi-m6",
      pointer: { target: "Configure > Agent Setup", exists: true },
    },
    {
      id: "qi-s5",
      label: "Issue comments",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "qi-m7",
    },
    {
      id: "qi-s6",
      label: "Profile settings",
      kind: "in-chat",
      messageEnd: 11,
      firstMessageId: "qi-m9",
    },
    {
      id: "qi-s7",
      label: "Model credential",
      kind: "in-chat",
      messageEnd: 13,
      firstMessageId: "qi-m11",
    },
    {
      id: "qi-s8",
      label: "Work backup",
      kind: "in-chat",
      messageEnd: 15,
      firstMessageId: "qi-m13",
    },
  ];

  return { messages: m, steps };
}
