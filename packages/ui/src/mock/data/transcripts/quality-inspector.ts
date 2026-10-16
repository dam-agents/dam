import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function qualityInspectorTranscript(): TranscriptMeta {
  const m = [
    msg("qi-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Quality Inspector**. I test every issue, run nightly regressions, and benchmark your product. Let's connect to your repo.",
      },
    ]),

    // Step 1: outside-chat — product profile/skill
    msg("qi-m1", "assistant", [
      {
        kind: "text" as const,
        text: "Open **Configure > Skills** and add the **Product Profile** skill so I know what I'm testing.",
      },
    ]),

    // Step 2: outside-chat — backend stack
    msg("qi-m2", "assistant", [
      {
        kind: "text" as const,
        text: "In the same **Configure > Skills** panel, tell me about your backend stack by adding the **Backend Config** skill.",
      },
    ]),

    // Step 3: outside-chat — egress rules
    msg("qi-m3", "assistant", [
      {
        kind: "text" as const,
        text: "Open **Configure > Agent Setup** and set your egress rules. I need network access to reach your staging environment.",
      },
    ]),

    // Step 4: outside-chat — model credential
    msg("qi-m4", "assistant", [
      {
        kind: "text" as const,
        text: "Connect a model credential in **Configure > Connections** — I use an LLM to generate test scenarios.",
      },
    ]),

    // Step 5: in-chat — work backup (partially outside)
    msg("qi-m5", "assistant", [
      form({
        formId: "qi-backup",
        formKind: "confirm",
        label: "Back up test results to GitHub? (You'll also want branch protection set up outside chat.)",
        summary: "Work backup: GitHub",
      }),
    ]),
    msg("qi-m6", "user", [{ kind: "text" as const, text: "Yes, GitHub is fine." }]),

    // Step 6: in-chat — target repo
    msg("qi-m7", "assistant", [
      form({
        formId: "qi-repo",
        formKind: "input",
        label: "Target repository for tests?",
        summary: "Repo: acme/platform",
      }),
    ]),
    msg("qi-m8", "user", [{ kind: "text" as const, text: "acme/platform" }]),

    // Step 7: in-chat — issue comments
    msg("qi-m9", "assistant", [
      form({
        formId: "qi-comments",
        formKind: "confirm",
        label: "Should I comment on issues with test results?",
        summary: "Issue comments: yes",
      }),
    ]),
    msg("qi-m10", "user", [{ kind: "text" as const, text: "Yes" }]),

    // Step 8: in-chat — profile settings
    msg("qi-m11", "assistant", [
      form({
        formId: "qi-profile-settings",
        formKind: "input",
        label: "Test profile name (shown in reports)?",
        summary: 'Profile: "QI Bot"',
      }),
    ]),
    msg("qi-m12", "user", [{ kind: "text" as const, text: "QI Bot" }]),

    // Step 9: in-chat — spec feedback
    msg("qi-m13", "assistant", [
      form({
        formId: "qi-spec-feedback",
        formKind: "confirm",
        label: "Should I leave feedback on specs/issues if testability is unclear?",
        summary: "Spec feedback: yes",
      }),
    ]),
    msg("qi-m14", "user", [{ kind: "text" as const, text: "Yes, that would help." }]),

    // Step 10: in-chat — Slack channel
    msg("qi-m15", "assistant", [
      form({
        formId: "qi-slack",
        formKind: "input",
        label: "Slack channel for test results? (leave blank to skip)",
        summary: "Slack: #qa-results",
      }),
    ]),
    msg("qi-m16", "user", [{ kind: "text" as const, text: "#qa-results" }]),

    // Step 11: in-chat — candidate/baseline channels
    msg("qi-m17", "assistant", [
      form({
        formId: "qi-channels",
        formKind: "input",
        label: "Candidate and baseline branch names for regression? (e.g. main, staging)",
        summary: "Branches: main vs staging",
      }),
    ]),
    msg("qi-m18", "user", [{ kind: "text" as const, text: "main and staging" }]),

    // Step 12: in-chat — scenario discovery
    msg("qi-m19", "assistant", [
      form({
        formId: "qi-scenarios",
        formKind: "select",
        label: "How should I discover test scenarios?",
        options: [
          { id: "issues", label: "From GitHub issues" },
          { id: "code", label: "From code changes" },
          { id: "both", label: "Both issues + code changes" },
        ],
        summary: "Scenarios: both issues + code",
      }),
    ]),
    msg("qi-m20", "user", [{ kind: "text" as const, text: "Both." }]),

    // Wrap-up
    msg("qi-m21", "assistant", [
      {
        kind: "text" as const,
        text: "All set. I'll start watching issues on **acme/platform** and testing them as they come in. The first hourly run kicks off shortly.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    { id: "qi-s1", label: "Product Profile skill", kind: "outside-chat", messageEnd: 2, firstMessageId: "qi-m1", pointer: { target: "Configure > Skills", exists: true } },
    { id: "qi-s2", label: "Backend Config skill", kind: "outside-chat", messageEnd: 3, firstMessageId: "qi-m2", pointer: { target: "Configure > Skills", exists: true } },
    { id: "qi-s3", label: "Egress rules", kind: "outside-chat", messageEnd: 4, firstMessageId: "qi-m3", pointer: { target: "Configure > Agent Setup", exists: true } },
    { id: "qi-s4", label: "Model credential", kind: "outside-chat", messageEnd: 5, firstMessageId: "qi-m4", pointer: { target: "Configure > Connections", exists: true } },
    { id: "qi-s5", label: "Work backup", kind: "in-chat", messageEnd: 7, firstMessageId: "qi-m5" },
    { id: "qi-s6", label: "Target repo", kind: "in-chat", messageEnd: 9, firstMessageId: "qi-m7" },
    { id: "qi-s7", label: "Issue comments", kind: "in-chat", messageEnd: 11, firstMessageId: "qi-m9" },
    { id: "qi-s8", label: "Profile settings", kind: "in-chat", messageEnd: 13, firstMessageId: "qi-m11" },
    { id: "qi-s9", label: "Spec feedback", kind: "in-chat", messageEnd: 15, firstMessageId: "qi-m13" },
    { id: "qi-s10", label: "Slack channel", kind: "in-chat", messageEnd: 17, firstMessageId: "qi-m15" },
    { id: "qi-s11", label: "Candidate/baseline", kind: "in-chat", messageEnd: 19, firstMessageId: "qi-m17" },
    { id: "qi-s12", label: "Scenario discovery", kind: "in-chat", messageEnd: 21, firstMessageId: "qi-m19" },
  ];

  return { messages: m, steps };
}
