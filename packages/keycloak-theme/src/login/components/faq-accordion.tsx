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
    question: "What is an agent?",
    answer:
      "An AI assistant with its own sandbox, files and tools. Give it a job, and it works on it, even while you’re away.",
    linkUrl: "https://ibm.biz/dam-docs",
    linkLabel: "Read the docs",
  },
  {
    question: "Can I use Claude Code?",
    answer:
      "Yes. Pick Claude Code, Codex or IBM Bob when you create an agent. DAM adds what your laptop can’t: it keeps running, on a schedule, and in Slack.",
  },
  {
    question: "Where does it run?",
    answer:
      "On IBM Research infrastructure, in its own isolated sandbox. Its files and keys stay inside it.",
  },
  {
    question: "Does it keep running when I close the tab?",
    answer:
      "Yes. Schedules and long jobs keep going when you’re offline. Results come back in Slack, or in DAM next time you open it.",
  },
  {
    question: "Can my team share an agent?",
    answer:
      "Yes. Add it to a Slack channel and anyone in the channel can use it. It works with your agent’s access, not theirs, so only share it where you’d share that access.",
  },
  {
    question: "Does the model see my data?",
    answer:
      "It sees what your agent reads, through the model provider you connect. It never sees your keys.",
  },
  {
    question: "What does it cost?",
    answer:
      "DAM itself is free to use. Model use is billed to the model key you connect.",
    linkUrl: "https://ibm.biz/dam-docs",
    linkLabel: "See the docs for details",
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
