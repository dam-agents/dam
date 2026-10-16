import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { msg } from "./helpers.js";

export function llmWikiTranscript(): TranscriptMeta {
  const m = [
    msg("lw-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **LLM Wiki**. I maintain structured knowledge pages with a knowledge graph. Let's set yours up — just tell me what you need and I'll take it from there.",
      },
    ]),

    // Step 1: in-chat conversational — name
    msg("lw-m1", "assistant", [
      {
        kind: "text" as const,
        text: "What should the wiki be called?",
      },
    ]),
    msg("lw-m2", "user", [{ kind: "text" as const, text: "Platform Knowledge Base" }]),

    // Step 2: in-chat conversational — purpose
    msg("lw-m3", "assistant", [
      {
        kind: "text" as const,
        text: "Good name. What kind of knowledge will it hold? Architecture docs, runbooks, onboarding guides — whatever you need organized.",
      },
    ]),
    msg("lw-m4", "user", [
      {
        kind: "text" as const,
        text: "Architecture docs, runbooks, and team processes.",
      },
    ]),

    // Step 3: in-chat conversational — sources
    msg("lw-m5", "assistant", [
      {
        kind: "text" as const,
        text: "Got it. Do you have any documents to start with? A repo folder, a Notion export, some markdown files — anything works.",
      },
    ]),
    msg("lw-m6", "user", [
      {
        kind: "text" as const,
        text: "The docs/ folder in our platform repo has the architecture pages.",
      },
    ]),

    // Step 4: in-chat conversational — backup preference
    msg("lw-m7", "assistant", [
      {
        kind: "text" as const,
        text: "I can store the wiki in a Git remote so it's versioned and portable, or keep it local-only. Which do you prefer?",
      },
    ]),
    msg("lw-m8", "user", [{ kind: "text" as const, text: "Git remote." }]),

    // Step 5: outside-chat — connect git remote
    msg("lw-m9", "assistant", [
      {
        kind: "text" as const,
        text: "Since you want Git storage, open **Configure > Connections** and make sure your GitHub account is connected. I'll push the wiki to a repo there.",
      },
    ]),

    // Step 6: in-chat conversational — maintenance
    msg("lw-m10", "assistant", [
      {
        kind: "text" as const,
        text: "Last thing — how often should I check pages for freshness? I can do daily sweeps, weekly, or only when you ask.",
      },
    ]),
    msg("lw-m11", "user", [{ kind: "text" as const, text: "Weekly is good." }]),

    // Step 7: outside-chat — set maintenance schedule
    msg("lw-m12", "assistant", [
      {
        kind: "text" as const,
        text: "Open the **Schedules** panel (via the ＋ menu) and add a weekly maintenance schedule. I'll use that to know when to check for stale pages.",
      },
    ]),

    // Wrap-up
    msg("lw-m13", "assistant", [
      {
        kind: "text" as const,
        text: "I'll start building **Platform Knowledge Base** from the docs/ folder. The knowledge graph will grow as I process the pages. Ask me anything or say \"update\" when the source material changes.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    { id: "lw-s1", label: "Wiki name", kind: "in-chat", messageEnd: 3, firstMessageId: "lw-m1" },
    { id: "lw-s2", label: "Purpose", kind: "in-chat", messageEnd: 5, firstMessageId: "lw-m3" },
    { id: "lw-s3", label: "Sources", kind: "in-chat", messageEnd: 7, firstMessageId: "lw-m5" },
    { id: "lw-s4", label: "Storage preference", kind: "in-chat", messageEnd: 9, firstMessageId: "lw-m7" },
    { id: "lw-s5", label: "Connect GitHub", kind: "outside-chat", messageEnd: 10, firstMessageId: "lw-m9", pointer: { target: "Configure > Connections", exists: true } },
    { id: "lw-s6", label: "Maintenance cadence", kind: "in-chat", messageEnd: 12, firstMessageId: "lw-m10" },
    { id: "lw-s7", label: "Set maintenance schedule", kind: "outside-chat", messageEnd: 13, firstMessageId: "lw-m12", pointer: { target: "Plus menu > Schedules", exists: true } },
  ];

  return { messages: m, steps };
}
