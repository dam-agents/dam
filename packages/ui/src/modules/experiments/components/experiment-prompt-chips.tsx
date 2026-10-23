import { useStore } from "../../../store.js";

const PROMPT_CHIPS = [
  "Show me an example to optimize",
  "How do experiments work?",
  "How is a run scored?",
  "What types of experiments can I run?",
  "Which agents can run the rounds?",
];

export function ExperimentPromptChips({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const hasUserMessage = useStore((s) =>
    s.messages.some((m) => m.role === "user"),
  );
  if (busy || hasUserMessage) return null;

  return (
    <div className="flex flex-wrap gap-2 pb-3">
      {PROMPT_CHIPS.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSend(question)}
          className="inline-flex h-[30px] items-center rounded-full border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted"
        >
          {question}
        </button>
      ))}
    </div>
  );
}
