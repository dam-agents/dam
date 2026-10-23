import type { Message } from "../../types.js";
import { mockSessions } from "./sessions.js";

function sessionTitle(agentId: string, sessionId: string): string {
  const list = (mockSessions[agentId] ?? []) as {
    sessionId: string;
    title?: string;
  }[];
  return list.find((s) => s.sessionId === sessionId)?.title ?? "this task";
}

function msg(
  id: string,
  role: Message["role"],
  parts: Message["parts"],
): Message {
  return { id, role, parts, streaming: false };
}

export function mockTranscript(agentId: string, sessionId: string): Message[] {
  const title = sessionTitle(agentId, sessionId);
  const p = `${sessionId}-m`;
  return [
    msg(`${p}1`, "user", [
      {
        kind: "text",
        text: `Can you pick up "${title}"? Start from what's already in the workspace and tell me what you find.`,
      },
    ]),
    msg(`${p}2`, "assistant", [
      {
        kind: "thought",
        text: "Check the README and the existing source before proposing changes.",
      },
      {
        kind: "tool",
        toolCallId: `${p}t1`,
        title: "Read README.md",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: `${p}t2`,
        title: "List files in src/",
        status: "completed",
        content: [
          {
            type: "terminal",
            text: "src/\n  components/\n  lib/\n  index.ts",
          },
        ],
      },
      {
        kind: "text",
        text: `I've gone through the workspace for **${title}**. Here's where things stand:\n\n- The main entry point is \`src/index.ts\`, and most of the logic lives in \`src/lib/\`.\n- There are no tests covering the current flow yet.\n- Two TODOs in \`src/components/\` look related to this work.\n\nI'd suggest starting with the TODOs, then adding a small test so we can check the change. Want me to go ahead?`,
      },
    ]),
    msg(`${p}3`, "user", [
      { kind: "text", text: "Yes, go ahead. Keep the change small." },
    ]),
    msg(`${p}4`, "assistant", [
      {
        kind: "tool",
        toolCallId: `${p}t3`,
        title: "Edit src/components/summary.tsx",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "- // TODO: handle empty state\n+ if (items.length === 0) return <EmptyState />;",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: `${p}t4`,
        title: "Run pnpm test",
        status: "completed",
        content: [{ type: "terminal", text: "✓ 12 tests passed" }],
      },
      {
        kind: "text",
        text: "Done. I handled the empty state in `summary.tsx` and all 12 tests pass. I also saved a short write-up as an artifact so you can share it.",
      },
    ]),
  ];
}

export function mockReply(text: string): string {
  const trimmed = text.trim();
  const subject =
    trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}…` : trimmed;
  return `Got it: "${subject}". This is a prototype, so I'm not running anything, but a real agent would pick this up in its workspace and report back here.`;
}
