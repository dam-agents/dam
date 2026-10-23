import { useState } from "react";

import { cn } from "../../lib/cn.js";

interface FaqItem {
  question: string;
  answer: string;
  linkUrl?: string;
  linkLabel?: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Which coding agents can I use?",
    answer:
      "DAM works with Claude Code, Codex, IBM Bob and Pi. You choose one when you create an agent, and each of your agents can use a different one. You can also bring your own coding agent in a custom image.",
    linkUrl:
      "https://pages.github.ibm.com/dam-agents/docs/core-concepts/agents/#available-harnesses",
    linkLabel: "See available coding agents",
  },
  {
    question: "Which model does my agent use?",
    answer:
      "You choose the model provider when you create an agent. Options include IBM’s LiteLLM proxy, Anthropic, OpenAI, AWS Bedrock and IBM Bob.",
    linkUrl:
      "https://pages.github.ibm.com/dam-agents/docs/reference/litellm-key/",
    linkLabel: "Get an IBM LiteLLM key",
  },
  {
    question: "Can I install my own tools?",
    answer:
      "Yes. Your agent can install what it needs while it works. Tools installed in its home folder stay. System packages go away when the agent goes to sleep, so build anything permanent into your own container image.",
    linkUrl:
      "https://pages.github.ibm.com/dam-agents/docs/core-concepts/agents/#what-survives-hibernation",
    linkLabel: "What your agent keeps",
  },
];

export function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="divide-y divide-input">
      {FAQ_ITEMS.map((item, i) => (
        <div key={i}>
          <button
            type="button"
            className="flex w-full items-center justify-between py-5 text-left text-[15px] font-medium leading-snug text-foreground"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            aria-expanded={openIndex === i}
          >
            <span>{item.question}</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className={cn(
                "shrink-0 ml-4 transition-transform duration-200",
                openIndex === i && "rotate-180",
              )}
              aria-hidden="true"
            >
              <path
                d="M4 6l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div
            className={cn(
              "overflow-hidden transition-[max-height,opacity] duration-200",
              openIndex === i
                ? "max-h-60 opacity-100"
                : "max-h-0 opacity-0",
            )}
          >
            <p className="pb-5 text-[15px] leading-relaxed text-muted-foreground">
              {item.answer}
              {item.linkUrl && (
                <>
                  {" "}
                  <a
                    href={item.linkUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline"
                  >
                    {item.linkLabel}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
