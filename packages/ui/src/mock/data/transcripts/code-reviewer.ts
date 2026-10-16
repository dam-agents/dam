import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function codeReviewerTranscript(): TranscriptMeta {
  const m = [
    msg("cg-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Code Reviewer**. I review every open pull request and nudge reviewers who go quiet. Let's get set up.",
      },
    ]),

    // Step 1: outside-chat — connect GitHub
    msg("cg-m1", "assistant", [
      {
        kind: "text" as const,
        text: "First, I need access to your repositories. Open **Configure > Connections** and connect your GitHub account.",
      },
    ]),

    // Step 2: outside-chat — GH Enterprise host
    msg("cg-m2", "assistant", [
      {
        kind: "text" as const,
        text: "If you're using GitHub Enterprise, set the host URL in **Configure > Connections** too. Skip this if you're on github.com.",
      },
    ]),

    // Step 3: agent — check GitHub account
    msg("cg-m3", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "cg-t1",
        title: "Check GitHub account access",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "GitHub access confirmed. I can see your repositories.",
      },
    ]),

    // Step 4: agent — set up config files
    msg("cg-m4", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "cg-t2",
        title: "Set up review config files",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "Config files created. Now let me ask some questions about how you want reviews to work.",
      },
    ]),

    // Step 5: in-chat — work backup
    msg("cg-m5", "assistant", [
      form({
        formId: "cg-backup",
        formKind: "confirm",
        label: 'Back up your review history, or say "local-only"?',
        summary: "Backup: local-only",
      }),
    ]),
    msg("cg-m6", "user", [{ kind: "text" as const, text: "Local-only for now." }]),

    // Step 6: in-chat — repo
    msg("cg-m7", "assistant", [
      form({
        formId: "cg-repo",
        formKind: "input",
        label: "Which repo should I review?",
        summary: "Repo: acme/web-app",
      }),
    ]),
    msg("cg-m8", "user", [{ kind: "text" as const, text: "acme/web-app" }]),

    // Step 7: in-chat — bot account
    msg("cg-m9", "assistant", [
      form({
        formId: "cg-bot-account",
        formKind: "confirm",
        label: "Use a dedicated bot account for reviews? Recommended for teams.",
        summary: "Bot account: yes",
      }),
    ]),
    msg("cg-m10", "user", [{ kind: "text" as const, text: "Yes, use a bot." }]),

    // Step 8: in-chat — review name
    msg("cg-m11", "assistant", [
      form({
        formId: "cg-name",
        formKind: "input",
        label: "What name should I sign reviews with?",
        summary: 'Review name: "Code Reviewer"',
      }),
    ]),
    msg("cg-m12", "user", [{ kind: "text" as const, text: "Code Reviewer" }]),

    // Step 9: in-chat — review marker
    msg("cg-m13", "assistant", [
      form({
        formId: "cg-marker",
        formKind: "input",
        label: "What prefix should I use on review comments? (e.g. 🤖, [Bot])",
        summary: "Marker: 🤖",
      }),
    ]),
    msg("cg-m14", "user", [{ kind: "text" as const, text: "🤖" }]),

    // Step 10: in-chat — labels: severity
    msg("cg-m15", "assistant", [
      form({
        formId: "cg-label-severity",
        formKind: "toggle-list",
        label: "Which severity labels should I apply?",
        options: [
          { id: "critical", label: "critical", defaultOn: true },
          { id: "major", label: "major", defaultOn: true },
          { id: "minor", label: "minor", defaultOn: true },
          { id: "nitpick", label: "nitpick", defaultOn: false },
        ],
        summary: "Severity labels: critical, major, minor",
      }),
    ]),
    msg("cg-m16", "user", [{ kind: "text" as const, text: "Skip nitpick, keep the rest." }]),

    // Step 11: in-chat — labels: category
    msg("cg-m17", "assistant", [
      form({
        formId: "cg-label-category",
        formKind: "toggle-list",
        label: "Category labels to apply on PRs?",
        options: [
          { id: "bug-fix", label: "bug-fix", defaultOn: true },
          { id: "feature", label: "feature", defaultOn: true },
          { id: "refactor", label: "refactor", defaultOn: true },
          { id: "docs", label: "docs", defaultOn: false },
          { id: "test", label: "test", defaultOn: false },
        ],
        summary: "Category labels: bug-fix, feature, refactor",
      }),
    ]),
    msg("cg-m18", "user", [{ kind: "text" as const, text: "Those three are fine." }]),

    // Step 12: in-chat — delivery: inline vs summary
    msg("cg-m19", "assistant", [
      form({
        formId: "cg-delivery-format",
        formKind: "select",
        label: "How should I deliver feedback?",
        options: [
          { id: "inline", label: "Inline comments on changed lines" },
          { id: "summary", label: "Single summary comment" },
          { id: "both", label: "Both inline + summary" },
        ],
        summary: "Delivery: inline + summary",
      }),
    ]),
    msg("cg-m20", "user", [{ kind: "text" as const, text: "Both." }]),

    // Step 13: in-chat — delivery: max comments
    msg("cg-m21", "assistant", [
      form({
        formId: "cg-max-comments",
        formKind: "input",
        label: "Max inline comments per PR? (0 = unlimited)",
        summary: "Max comments: 20",
      }),
    ]),
    msg("cg-m22", "user", [{ kind: "text" as const, text: "20" }]),

    // Step 14: in-chat — delivery: approval behavior
    msg("cg-m23", "assistant", [
      form({
        formId: "cg-auto-approve",
        formKind: "select",
        label: "Auto-approve clean PRs?",
        options: [
          { id: "never", label: "Never (always leave for a human)" },
          { id: "trivial", label: "Only trivial PRs (< 10 lines)" },
          { id: "always", label: "Always if no issues found" },
        ],
        summary: "Auto-approve: only trivial PRs",
      }),
    ]),
    msg("cg-m24", "user", [{ kind: "text" as const, text: "Only trivial." }]),

    // Step 15: in-chat — re-review label
    msg("cg-m25", "assistant", [
      form({
        formId: "cg-re-review",
        formKind: "input",
        label: "What label triggers a re-review? (e.g. needs-re-review)",
        summary: "Re-review label: needs-re-review",
      }),
    ]),
    msg("cg-m26", "user", [{ kind: "text" as const, text: "needs-re-review" }]),

    // Step 16: in-chat — auto-merge
    msg("cg-m27", "assistant", [
      form({
        formId: "cg-auto-merge",
        formKind: "confirm",
        label: "Auto-merge when all checks pass?",
        summary: "Auto-merge: off",
      }),
    ]),
    msg("cg-m28", "user", [{ kind: "text" as const, text: "No, keep it off." }]),

    // Step 17: in-chat — PR size warning
    msg("cg-m29", "assistant", [
      form({
        formId: "cg-pr-size",
        formKind: "input",
        label: "Warn when a PR exceeds how many changed lines? (0 = never)",
        summary: "PR size warning: 500 lines",
      }),
    ]),
    msg("cg-m30", "user", [{ kind: "text" as const, text: "500" }]),

    // Step 18: in-chat — required reviewers
    msg("cg-m31", "assistant", [
      form({
        formId: "cg-required-reviewers",
        formKind: "input",
        label: "Minimum number of human approvals before merge?",
        summary: "Required reviewers: 1",
      }),
    ]),
    msg("cg-m32", "user", [{ kind: "text" as const, text: "1" }]),

    // Step 19: in-chat — skills: code style
    msg("cg-m33", "assistant", [
      form({
        formId: "cg-skills",
        formKind: "toggle-list",
        label: "Which review skills should I enable?",
        options: [
          { id: "security", label: "Security scan", defaultOn: true },
          { id: "perf", label: "Performance hints", defaultOn: true },
          { id: "style", label: "Code style", defaultOn: false },
          { id: "accessibility", label: "Accessibility checks", defaultOn: false },
          { id: "test-coverage", label: "Test coverage check", defaultOn: true },
        ],
        summary: "Skills: security, perf, test-coverage",
      }),
    ]),
    msg("cg-m34", "user", [{ kind: "text" as const, text: "Security, perf, test coverage." }]),

    // Step 20: in-chat — artifacts
    msg("cg-m35", "assistant", [
      form({
        formId: "cg-artifacts",
        formKind: "toggle-list",
        label: "What artifacts should I produce?",
        options: [
          { id: "review-report", label: "Review report per PR", defaultOn: true },
          { id: "weekly-digest", label: "Weekly review digest", defaultOn: true },
          { id: "metrics-dashboard", label: "Metrics dashboard data", defaultOn: false },
        ],
        summary: "Artifacts: review reports, weekly digest",
      }),
    ]),
    msg("cg-m36", "user", [{ kind: "text" as const, text: "Reports and the digest." }]),

    // Step 21: in-chat — Slack channel
    msg("cg-m37", "assistant", [
      form({
        formId: "cg-slack",
        formKind: "input",
        label: "Slack channel for review notifications? (leave blank to skip)",
        summary: "Slack: #code-reviews",
      }),
    ]),
    msg("cg-m38", "user", [{ kind: "text" as const, text: "#code-reviews" }]),

    // Step 22: in-chat — escalation path
    msg("cg-m39", "assistant", [
      form({
        formId: "cg-escalation",
        formKind: "select",
        label: "When a PR is blocked for > 48h, how should I escalate?",
        options: [
          { id: "slack-dm", label: "DM the author on Slack" },
          { id: "slack-channel", label: "Post in the Slack channel" },
          { id: "both", label: "Both DM + channel" },
          { id: "none", label: "Don't escalate" },
        ],
        summary: "Escalation: DM author on Slack",
      }),
    ]),
    msg("cg-m40", "user", [{ kind: "text" as const, text: "DM the author." }]),

    // Step 23: in-chat — benchmark frequency
    msg("cg-m41", "assistant", [
      form({
        formId: "cg-benchmark",
        formKind: "select",
        label: "How often should I benchmark review quality?",
        options: [
          { id: "weekly", label: "Weekly" },
          { id: "monthly", label: "Monthly" },
          { id: "never", label: "Never" },
        ],
        summary: "Benchmark: monthly",
      }),
    ]),
    msg("cg-m42", "user", [{ kind: "text" as const, text: "Monthly." }]),

    // Step 24: in-chat — nudge frequency
    msg("cg-m43", "assistant", [
      form({
        formId: "cg-nudge",
        formKind: "select",
        label: "How often should I nudge idle reviewers?",
        options: [
          { id: "4h", label: "Every 4 hours" },
          { id: "daily", label: "Once per day" },
          { id: "never", label: "Never" },
        ],
        summary: "Nudge: once per day",
      }),
    ]),
    msg("cg-m44", "user", [{ kind: "text" as const, text: "Once a day is fine." }]),

    // Step 25: in-chat — review survey
    msg("cg-m45", "assistant", [
      form({
        formId: "cg-survey",
        formKind: "confirm",
        label: "Send a short satisfaction survey to PR authors after merge?",
        summary: "Survey: no",
      }),
    ]),
    msg("cg-m46", "user", [{ kind: "text" as const, text: "No." }]),

    // Step 26: in-chat — review cadence hours
    msg("cg-m47", "assistant", [
      form({
        formId: "cg-cadence",
        formKind: "select",
        label: "When should I run reviews?",
        options: [
          { id: "realtime", label: "Real-time (within 5 min of push)" },
          { id: "hourly", label: "Hourly batch" },
          { id: "workday", label: "Workday hours only (9-6)" },
        ],
        summary: "Cadence: real-time",
      }),
    ]),
    msg("cg-m48", "user", [{ kind: "text" as const, text: "Real-time." }]),

    // Step 27: in-chat — tracking
    msg("cg-m49", "assistant", [
      form({
        formId: "cg-tracking",
        formKind: "toggle-list",
        label: "What should I track across reviews?",
        options: [
          { id: "review-time", label: "Review cycle time", defaultOn: true },
          { id: "recurrence", label: "Recurring issues", defaultOn: true },
          { id: "hotspots", label: "File hotspots", defaultOn: true },
          { id: "reviewer-load", label: "Reviewer load balance", defaultOn: false },
        ],
        summary: "Tracking: cycle time, recurring issues, hotspots",
      }),
    ]),
    msg("cg-m50", "user", [{ kind: "text" as const, text: "Those three, skip load balance." }]),

    // Step 28: in-chat — health checks
    msg("cg-m51", "assistant", [
      form({
        formId: "cg-health",
        formKind: "toggle-list",
        label: "Health checks to run before each review?",
        options: [
          { id: "lint", label: "Lint passes", defaultOn: true },
          { id: "build", label: "Build succeeds", defaultOn: true },
          { id: "tests", label: "Tests pass", defaultOn: true },
          { id: "coverage", label: "Coverage threshold met", defaultOn: false },
        ],
        summary: "Health: lint, build, tests",
      }),
    ]),
    msg("cg-m52", "user", [{ kind: "text" as const, text: "Lint, build, and tests." }]),

    // Step 29: in-chat — protected branches
    msg("cg-m53", "assistant", [
      form({
        formId: "cg-protected",
        formKind: "input",
        label: "Protected branches I should never auto-merge into? (comma-separated)",
        summary: "Protected: main, production",
      }),
    ]),
    msg("cg-m54", "user", [{ kind: "text" as const, text: "main, production" }]),

    // Step 30: in-chat — draft PRs
    msg("cg-m55", "assistant", [
      form({
        formId: "cg-drafts",
        formKind: "confirm",
        label: "Should I review draft PRs or wait until they're marked ready?",
        summary: "Drafts: wait until ready",
      }),
    ]),
    msg("cg-m56", "user", [{ kind: "text" as const, text: "Wait until ready." }]),

    // Step 31: agent — reconcile schedules + final
    msg("cg-m57", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "cg-t3",
        title: "Reconcile schedules and save configuration",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "All set. I'll start watching **acme/web-app** for pull requests. You can change any of these settings later from the session menu.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    { id: "cg-s1", label: "Connect GitHub", kind: "outside-chat", messageEnd: 2, firstMessageId: "cg-m1", pointer: { target: "Configure > Connections", exists: true } },
    { id: "cg-s2", label: "GH Enterprise host", kind: "outside-chat", messageEnd: 3, firstMessageId: "cg-m2", pointer: { target: "Configure > Connections", exists: true } },
    { id: "cg-s3", label: "Check GitHub access", kind: "agent", messageEnd: 4, firstMessageId: "cg-m3" },
    { id: "cg-s4", label: "Set up config files", kind: "agent", messageEnd: 5, firstMessageId: "cg-m4" },
    { id: "cg-s5", label: "Work backup", kind: "in-chat", messageEnd: 7, firstMessageId: "cg-m5" },
    { id: "cg-s6", label: "Target repo", kind: "in-chat", messageEnd: 9, firstMessageId: "cg-m7" },
    { id: "cg-s7", label: "Bot account", kind: "in-chat", messageEnd: 11, firstMessageId: "cg-m9" },
    { id: "cg-s8", label: "Review name", kind: "in-chat", messageEnd: 13, firstMessageId: "cg-m11" },
    { id: "cg-s9", label: "Review marker", kind: "in-chat", messageEnd: 15, firstMessageId: "cg-m13" },
    { id: "cg-s10", label: "Severity labels", kind: "in-chat", messageEnd: 17, firstMessageId: "cg-m15" },
    { id: "cg-s11", label: "Category labels", kind: "in-chat", messageEnd: 19, firstMessageId: "cg-m17" },
    { id: "cg-s12", label: "Delivery format", kind: "in-chat", messageEnd: 21, firstMessageId: "cg-m19" },
    { id: "cg-s13", label: "Max comments", kind: "in-chat", messageEnd: 23, firstMessageId: "cg-m21" },
    { id: "cg-s14", label: "Auto-approve", kind: "in-chat", messageEnd: 25, firstMessageId: "cg-m23" },
    { id: "cg-s15", label: "Re-review label", kind: "in-chat", messageEnd: 27, firstMessageId: "cg-m25" },
    { id: "cg-s16", label: "Auto-merge", kind: "in-chat", messageEnd: 29, firstMessageId: "cg-m27" },
    { id: "cg-s17", label: "PR size warning", kind: "in-chat", messageEnd: 31, firstMessageId: "cg-m29" },
    { id: "cg-s18", label: "Required reviewers", kind: "in-chat", messageEnd: 33, firstMessageId: "cg-m31" },
    { id: "cg-s19", label: "Review skills", kind: "in-chat", messageEnd: 35, firstMessageId: "cg-m33" },
    { id: "cg-s20", label: "Artifacts", kind: "in-chat", messageEnd: 37, firstMessageId: "cg-m35" },
    { id: "cg-s21", label: "Slack channel", kind: "in-chat", messageEnd: 39, firstMessageId: "cg-m37" },
    { id: "cg-s22", label: "Escalation path", kind: "in-chat", messageEnd: 41, firstMessageId: "cg-m39" },
    { id: "cg-s23", label: "Benchmark", kind: "in-chat", messageEnd: 43, firstMessageId: "cg-m41" },
    { id: "cg-s24", label: "Nudge frequency", kind: "in-chat", messageEnd: 45, firstMessageId: "cg-m43" },
    { id: "cg-s25", label: "Satisfaction survey", kind: "in-chat", messageEnd: 47, firstMessageId: "cg-m45" },
    { id: "cg-s26", label: "Review cadence", kind: "in-chat", messageEnd: 49, firstMessageId: "cg-m47" },
    { id: "cg-s27", label: "Tracking metrics", kind: "in-chat", messageEnd: 51, firstMessageId: "cg-m49" },
    { id: "cg-s28", label: "Health checks", kind: "in-chat", messageEnd: 53, firstMessageId: "cg-m51" },
    { id: "cg-s29", label: "Protected branches", kind: "in-chat", messageEnd: 55, firstMessageId: "cg-m53" },
    { id: "cg-s30", label: "Draft PRs", kind: "in-chat", messageEnd: 57, firstMessageId: "cg-m55" },
    { id: "cg-s31", label: "Reconcile & finish", kind: "agent", messageEnd: 58, firstMessageId: "cg-m57" },
  ];

  return { messages: m, steps };
}
