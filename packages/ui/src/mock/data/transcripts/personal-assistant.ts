import { form, msg } from "./helpers.js";
import type { TranscriptMeta, TranscriptStep } from "./types.js";

export function personalAssistantTranscript(): TranscriptMeta {
  const m = [
    msg("pa-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Hi, I'm your **Personal Assistant**. I'll live in your DMs, run your briefing, and handle the small stuff. Your messaging is connected — let me learn about you.",
      },
    ]),

    // Step 1: in-chat — who I am
    msg("pa-m1", "assistant", [
      form({
        formId: "pa-who",
        formKind: "input",
        label:
          "Tell me about yourself — name, role, team, what you're working on.",
        summary: "Profile: Jamie, product designer, platform team",
      }),
    ]),
    msg("pa-m2", "user", [
      {
        kind: "text" as const,
        text: "I'm Jamie, a product designer on the platform team. Mostly working on the agent onboarding flow right now.",
      },
    ]),

    // Step 2: in-chat — what I take care of
    msg("pa-m3", "assistant", [
      form({
        formId: "pa-responsibilities",
        formKind: "input",
        label:
          "What kinds of things do you take care of day-to-day? (so I know what to help with)",
        summary:
          "Responsibilities: design reviews, prototyping, user research synthesis",
      }),
    ]),
    msg("pa-m4", "user", [
      {
        kind: "text" as const,
        text: "Design reviews, prototyping, and user research synthesis.",
      },
    ]),

    // Step 3: in-chat — how we work together
    msg("pa-m5", "assistant", [
      form({
        formId: "pa-working-style",
        formKind: "select",
        label: "How should we work together?",
        options: [
          {
            id: "proactive",
            label: "Proactive — message me first, suggest things",
          },
          { id: "reactive", label: "Reactive — wait for me to ask" },
          {
            id: "brief-only",
            label:
              "Briefings only — morning summary, nothing else unless I ask",
          },
        ],
        summary: "Working style: proactive",
      }),
    ]),
    msg("pa-m6", "user", [{ kind: "text" as const, text: "Proactive." }]),

    // Step 4: in-chat — Slack member ID
    msg("pa-m7", "assistant", [
      form({
        formId: "pa-slack-id",
        formKind: "input",
        label: "What's your Slack member ID? (Settings > Copy Member ID)",
        summary: "Slack ID: U04B7K2QXYZ",
      }),
    ]),
    msg("pa-m8", "user", [{ kind: "text" as const, text: "U04B7K2QXYZ" }]),

    // Wrap-up
    msg("pa-m9", "assistant", [
      {
        kind: "text" as const,
        text: "All set. I'll send your first briefing tomorrow morning. If you need anything before then, just message me.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    {
      id: "pa-s1",
      label: "Who I am",
      kind: "in-chat",
      messageEnd: 3,
      firstMessageId: "pa-m1",
    },
    {
      id: "pa-s2",
      label: "What I take care of",
      kind: "in-chat",
      messageEnd: 5,
      firstMessageId: "pa-m3",
    },
    {
      id: "pa-s3",
      label: "How we work together",
      kind: "in-chat",
      messageEnd: 7,
      firstMessageId: "pa-m5",
    },
    {
      id: "pa-s4",
      label: "Your Slack member ID",
      kind: "in-chat",
      messageEnd: 9,
      firstMessageId: "pa-m7",
    },
  ];

  return { messages: m, steps };
}
