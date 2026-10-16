import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { form, msg } from "./helpers.js";

export function personalAssistantTranscript(): TranscriptMeta {
  const m = [
    msg("pa-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Hi, I'm your **Personal Assistant**. I'll live in your DMs, run your briefing, and handle the small stuff. Let's connect your messaging first.",
      },
    ]),

    // Step 1: outside-chat — connect Slack/Telegram
    msg("pa-m1", "assistant", [
      {
        kind: "text" as const,
        text: "Open **Configure > Connections** and connect Slack or Telegram — that's where I'll live.",
      },
    ]),

    // Step 2: outside-chat — set up schedules
    msg("pa-m2", "assistant", [
      {
        kind: "text" as const,
        text: "Next, open the **Schedules** panel (via the ＋ menu) and set up your briefing times.",
      },
    ]),

    // Step 3: agent — check tools
    msg("pa-m3", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "pa-t1",
        title: "Check connected tools and GitHub access",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "Connected tools confirmed. Now let me learn about you so I can be actually useful.",
      },
    ]),

    // Step 4: in-chat — name
    msg("pa-m4", "assistant", [
      form({
        formId: "pa-name",
        formKind: "input",
        label: "What should I call you?",
        summary: "Name: Jamie",
      }),
    ]),
    msg("pa-m5", "user", [{ kind: "text" as const, text: "Jamie" }]),

    // Step 5: in-chat — role/about
    msg("pa-m6", "assistant", [
      form({
        formId: "pa-who",
        formKind: "input",
        label: "Tell me about yourself — role, team, what you're working on.",
        summary: "Profile saved",
      }),
    ]),
    msg("pa-m7", "user", [
      {
        kind: "text" as const,
        text: "I'm a product designer on the platform team. Mostly working on the agent onboarding flow right now.",
      },
    ]),

    // Step 6: in-chat — voice/tone
    msg("pa-m8", "assistant", [
      form({
        formId: "pa-voice",
        formKind: "select",
        label: "How should I talk to you?",
        options: [
          { id: "casual", label: "Casual — short, friendly" },
          { id: "professional", label: "Professional — clear, structured" },
          { id: "minimal", label: "Minimal — just the facts" },
        ],
        summary: "Voice: casual",
      }),
    ]),
    msg("pa-m9", "user", [{ kind: "text" as const, text: "Casual." }]),

    // Step 7: in-chat — guardrails
    msg("pa-m10", "assistant", [
      form({
        formId: "pa-guardrails",
        formKind: "confirm",
        label: "Should I ask before taking actions, or just do things and report?",
        summary: "Guardrails: ask first",
      }),
    ]),
    msg("pa-m11", "user", [{ kind: "text" as const, text: "Ask first." }]),

    // Step 8: in-chat — capabilities
    msg("pa-m12", "assistant", [
      form({
        formId: "pa-tasks",
        formKind: "toggle-list",
        label: "What kinds of things should I help with?",
        options: [
          { id: "reminders", label: "Reminders", defaultOn: true },
          { id: "lookups", label: "Quick lookups", defaultOn: true },
          { id: "briefing", label: "Morning briefing", defaultOn: true },
          { id: "drafting", label: "Message drafting", defaultOn: false },
          { id: "scheduling", label: "Meeting scheduling", defaultOn: false },
        ],
        summary: "Handles: reminders, quick lookups, morning briefing",
      }),
    ]),
    msg("pa-m13", "user", [
      {
        kind: "text" as const,
        text: "Reminders, quick lookups, and the morning briefing.",
      },
    ]),

    // Step 9: in-chat — what to stay out of
    msg("pa-m14", "assistant", [
      form({
        formId: "pa-boundaries",
        formKind: "input",
        label: "Anything I should definitely stay out of?",
        summary: "Boundaries: no calendar changes without asking",
      }),
    ]),
    msg("pa-m15", "user", [
      {
        kind: "text" as const,
        text: "Don't touch my calendar without asking first.",
      },
    ]),

    // Step 10: in-chat — Slack member ID
    msg("pa-m16", "assistant", [
      form({
        formId: "pa-slack-id",
        formKind: "input",
        label: "What's your Slack member ID? (Settings > Copy Member ID)",
        summary: "Slack ID saved",
      }),
    ]),
    msg("pa-m17", "user", [{ kind: "text" as const, text: "U04B7K2QXYZ" }]),

    // Step 11: in-chat — messaging preferences
    msg("pa-m18", "assistant", [
      form({
        formId: "pa-may-message",
        formKind: "confirm",
        label: "Can I message you first, or should I wait for you to start?",
        summary: "May message first: yes",
      }),
    ]),
    msg("pa-m19", "user", [
      { kind: "text" as const, text: "You can message me first." },
    ]),

    // Step 12: in-chat — timezone
    msg("pa-m20", "assistant", [
      form({
        formId: "pa-timezone",
        formKind: "input",
        label: "What timezone are you in?",
        summary: "Timezone: Australia/Sydney",
      }),
    ]),
    msg("pa-m21", "user", [{ kind: "text" as const, text: "Australia/Sydney" }]),

    // Step 13: in-chat — privacy / backup
    msg("pa-m22", "assistant", [
      form({
        formId: "pa-backup",
        formKind: "confirm",
        label: "Back up conversation history to GitHub?",
        summary: "Backup: local-only",
      }),
    ]),
    msg("pa-m23", "user", [{ kind: "text" as const, text: "No, local-only." }]),

    // Step 14: in-chat — task prefix
    msg("pa-m24", "assistant", [
      form({
        formId: "pa-prefix",
        formKind: "input",
        label: "Prefix for tasks I create? (e.g. [PA], leave blank for none)",
        summary: "Task prefix: [PA]",
      }),
    ]),
    msg("pa-m25", "user", [{ kind: "text" as const, text: "[PA]" }]),

    // Wrap-up
    msg("pa-m26", "assistant", [
      {
        kind: "text" as const,
        text: "All set. I'll send your first briefing tomorrow morning. If you need anything before then, just message me.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    { id: "pa-s1", label: "Connect Slack/Telegram", kind: "outside-chat", messageEnd: 2, firstMessageId: "pa-m1", pointer: { target: "Configure > Connections", exists: true } },
    { id: "pa-s2", label: "Set up schedules", kind: "outside-chat", messageEnd: 3, firstMessageId: "pa-m2", pointer: { target: "Plus menu > Schedules", exists: true } },
    { id: "pa-s3", label: "Check tools", kind: "agent", messageEnd: 4, firstMessageId: "pa-m3" },
    { id: "pa-s4", label: "Your name", kind: "in-chat", messageEnd: 6, firstMessageId: "pa-m4" },
    { id: "pa-s5", label: "About you", kind: "in-chat", messageEnd: 8, firstMessageId: "pa-m6" },
    { id: "pa-s6", label: "Voice/tone", kind: "in-chat", messageEnd: 10, firstMessageId: "pa-m8" },
    { id: "pa-s7", label: "Guardrails", kind: "in-chat", messageEnd: 12, firstMessageId: "pa-m10" },
    { id: "pa-s8", label: "Capabilities", kind: "in-chat", messageEnd: 14, firstMessageId: "pa-m12" },
    { id: "pa-s9", label: "Boundaries", kind: "in-chat", messageEnd: 16, firstMessageId: "pa-m14" },
    { id: "pa-s10", label: "Slack member ID", kind: "in-chat", messageEnd: 18, firstMessageId: "pa-m16" },
    { id: "pa-s11", label: "Messaging prefs", kind: "in-chat", messageEnd: 20, firstMessageId: "pa-m18" },
    { id: "pa-s12", label: "Timezone", kind: "in-chat", messageEnd: 22, firstMessageId: "pa-m20" },
    { id: "pa-s13", label: "Privacy/backup", kind: "in-chat", messageEnd: 24, firstMessageId: "pa-m22" },
    { id: "pa-s14", label: "Task prefix", kind: "in-chat", messageEnd: 26, firstMessageId: "pa-m24" },
  ];

  return { messages: m, steps };
}
