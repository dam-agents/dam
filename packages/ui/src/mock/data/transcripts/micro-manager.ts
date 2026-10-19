import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function microManagerTranscript(): TranscriptMeta {
  const m = [
    msg("mm-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Micro-Manager**. I read your Slack conversations, track what you've asked people to do, and follow up when things go quiet. Your Slack account is connected — let's configure how I work.",
      },
    ]),

    // Step 1: in-chat — confirm Slack account
    msg("mm-m1", "assistant", [
      form({
        formId: "mm-slack",
        formKind: "confirm",
        label:
          "I'm connected as you (not a bot). Confirm this is the right Slack account?",
        summary: "Slack account confirmed",
      }),
    ]),
    msg("mm-m2", "user", [
      { kind: "text" as const, text: "Yes, that's correct." },
    ]),

    // Step 2: in-chat — which channels to read
    msg("mm-m3", "assistant", [
      form({
        formId: "mm-channels",
        formKind: "input",
        label: "Which Slack channels should I watch? (comma-separated)",
        summary: "Channels: #engineering, #platform-alerts, #deployments",
      }),
    ]),
    msg("mm-m4", "user", [
      {
        kind: "text" as const,
        text: "#engineering, #platform-alerts, #deployments",
      },
    ]),

    // Step 3: in-chat — who you hand work to
    msg("mm-m5", "assistant", [
      form({
        formId: "mm-delegates",
        formKind: "input",
        label:
          "Who do you usually hand work to? List names or Slack handles so I know what to track.",
        summary: "Delegates: @alex, @sam, @jordan",
      }),
    ]),
    msg("mm-m6", "user", [
      { kind: "text" as const, text: "@alex, @sam, @jordan" },
    ]),

    // Step 4: in-chat — which bots you talk to
    msg("mm-m7", "assistant", [
      form({
        formId: "mm-bots",
        formKind: "input",
        label:
          'Any bots you interact with that I should recognize? (e.g. @linear, @github-bot, or "none")',
        summary: "Bots: @linear, @github-bot",
      }),
    ]),
    msg("mm-m8", "user", [
      { kind: "text" as const, text: "@linear, @github-bot" },
    ]),

    // Step 5: in-chat — approve dry run
    msg("mm-m9", "assistant", [
      form({
        formId: "mm-dry-run",
        formKind: "confirm",
        label:
          "I'll do a dry run first — scan the last 48 hours of messages and show you what I'd track. Ready to approve?",
        summary: "Dry run approved",
      }),
    ]),
    msg("mm-m10", "user", [{ kind: "text" as const, text: "Go ahead." }]),

    // Agent runs dry run
    msg("mm-m11", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "mm-t1",
        title: "Scan last 48 hours of Slack messages",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "Dry run complete. I found 7 delegated tasks across 3 channels. I'll start tracking these and send you a daily summary. You can adjust channels and delegates anytime.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "mm-s1",
      label: "Confirm your Slack account",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "mm-m1",
    },
    {
      id: "mm-s2",
      label: "Which channels to read",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "mm-m3",
    },
    {
      id: "mm-s3",
      label: "Who you hand work to",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "mm-m5",
    },
    {
      id: "mm-s4",
      label: "Which bots you talk to",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "mm-m7",
    },
    {
      id: "mm-s5",
      label: "Approve the dry run",
      kind: "in-chat",
      messageEnd: 11,
      firstMessageId: "mm-m9",
    },
  ];

  return { messages: m, steps };
}
