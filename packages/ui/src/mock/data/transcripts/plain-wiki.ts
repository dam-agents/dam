import type { TranscriptMeta, TranscriptStep } from "./types.js";
import { msg } from "./helpers.js";

export function plainWikiTranscript(): TranscriptMeta {
  const m = [
    msg("pw-m0", "assistant", [
      {
        kind: "text" as const,
        text: "Welcome to **Plain Wiki**. I keep a simple markdown knowledge base for you. Just tell me what to remember.",
      },
    ]),

    // Step 1: in-chat conversational — purpose
    msg("pw-m1", "assistant", [
      {
        kind: "text" as const,
        text: "What's this knowledge base for?",
      },
    ]),
    msg("pw-m2", "user", [{ kind: "text" as const, text: "Team onboarding notes." }]),

    // Step 2: in-chat conversational — first material
    msg("pw-m3", "assistant", [
      {
        kind: "text" as const,
        text: "Good. Got any notes or files to start with? You can paste a link, describe what you have, or I can start from scratch.",
      },
    ]),
    msg("pw-m4", "user", [
      { kind: "text" as const, text: "I have a getting-started.md in the repo." },
    ]),

    // Step 3: in-chat conversational — publish
    msg("pw-m5", "assistant", [
      {
        kind: "text" as const,
        text: "Should I publish it for the team, or keep it private for now?",
      },
    ]),
    msg("pw-m6", "user", [{ kind: "text" as const, text: "Publish it." }]),

    // Step 4: agent — import + publish
    msg("pw-m7", "assistant", [
      {
        kind: "tool" as const,
        toolCallId: "pw-t1",
        title: "Import getting-started.md and publish wiki",
        status: "completed",
      },
      {
        kind: "text" as const,
        text: "Done. I've imported getting-started.md and the wiki is live.",
      },
    ]),

    // Step 5: outside-chat — manage KB
    msg("pw-m8", "assistant", [
      {
        kind: "text" as const,
        text: "You can manage published pages from the **Knowledge Bases** panel. Send me new notes any time and I'll file them.",
      },
    ]),
  ];

  const steps: TranscriptStep[] = [
    { id: "pw-s1", label: "Purpose", kind: "in-chat", messageEnd: 3, firstMessageId: "pw-m1" },
    { id: "pw-s2", label: "First material", kind: "in-chat", messageEnd: 5, firstMessageId: "pw-m3" },
    { id: "pw-s3", label: "Publish decision", kind: "in-chat", messageEnd: 7, firstMessageId: "pw-m5" },
    { id: "pw-s4", label: "Import & publish", kind: "agent", messageEnd: 8, firstMessageId: "pw-m7" },
    { id: "pw-s5", label: "Manage KB", kind: "outside-chat", messageEnd: 9, firstMessageId: "pw-m8", pointer: { target: "Knowledge Bases panel", exists: false } },
  ];

  return { messages: m, steps };
}
