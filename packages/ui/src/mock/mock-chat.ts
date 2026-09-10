import type { Message, MessagePart } from "../types.js";

interface MockStep {
  delay: number;
  parts: MessagePart[];
  streaming: boolean;
}

function deriveScheduleName(prompt: string): string {
  const first = prompt.split(",")[0]?.trim() ?? "";
  if (first.length > 40) return first.slice(0, 37) + "…";
  return first || "New schedule";
}

function buildSteps(userPrompt: string): MockStep[] {
  const name = deriveScheduleName(userPrompt);

  return [
    {
      delay: 500,
      parts: [
        {
          kind: "tool",
          title: "Parsing schedule request…",
          status: "in_progress",
        },
      ],
      streaming: true,
    },
    {
      delay: 1200,
      parts: [
        { kind: "tool", title: "Parsing schedule request", status: "complete" },
        {
          kind: "tool",
          title: "Creating schedule…",
          status: "in_progress",
        },
      ],
      streaming: true,
    },
    {
      delay: 1400,
      parts: [
        { kind: "tool", title: "Parsing schedule request", status: "complete" },
        { kind: "tool", title: "Creating schedule", status: "complete" },
        {
          kind: "text",
          text: `I created **${name}** and it's active now. Here's what I set up:`,
        },
      ],
      streaming: true,
    },
    {
      delay: 600,
      parts: [
        { kind: "tool", title: "Parsing schedule request", status: "complete" },
        { kind: "tool", title: "Creating schedule", status: "complete" },
        {
          kind: "text",
          text: `I created **${name}** and it's active now. Here's what I set up:`,
        },
        {
          kind: "mock-schedule-card",
          schedule: {
            name,
            prompt: userPrompt,
            frequency: "Daily",
            days: "Weekdays",
            time: "9:00 AM",
            timezone: "America/Los_Angeles",
            sessionMode: "Fresh",
          },
        },
      ],
      streaming: true,
    },
    {
      delay: 800,
      parts: [
        { kind: "tool", title: "Parsing schedule request", status: "complete" },
        { kind: "tool", title: "Creating schedule", status: "complete" },
        {
          kind: "text",
          text: `I created **${name}** and it's active now. Here's what I set up:`,
        },
        {
          kind: "mock-schedule-card",
          schedule: {
            name,
            prompt: userPrompt,
            frequency: "Daily",
            days: "Weekdays",
            time: "9:00 AM",
            timezone: "America/Los_Angeles",
            sessionMode: "Fresh",
          },
        },
        {
          kind: "text",
          text: "The first run will fire tomorrow at 9:00 AM Pacific. You can edit it any time from the **Schedules** page.",
        },
      ],
      streaming: false,
    },
  ];
}

export function runMockChat(
  userPrompt: string,
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
  setSessionId: (id: string | null) => void,
): void {
  const sessionId = `mock-${crypto.randomUUID().slice(0, 8)}`;
  setSessionId(sessionId);

  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text: userPrompt }],
    streaming: false,
  };

  const assistantId = crypto.randomUUID();
  const assistantMsg: Message = {
    id: assistantId,
    role: "assistant",
    parts: [],
    streaming: true,
  };

  setMessages([userMsg, assistantMsg]);

  const steps = buildSteps(userPrompt);
  let elapsed = 0;

  for (const step of steps) {
    elapsed += step.delay;
    const { parts, streaming } = step;

    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, parts, streaming } : m,
        ),
      );
    }, elapsed);
  }
}
