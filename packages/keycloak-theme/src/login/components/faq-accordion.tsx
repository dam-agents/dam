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
      "An agent is an AI assistant that runs in its own secure environment with the tools and credentials it needs. You give it a task, and it works on it — writing code, reviewing changes, or monitoring systems.",
    linkUrl: "https://ibm.biz/dam-docs",
    linkLabel: "Read the docs",
  },
  {
    question: "Where does it run?",
    answer:
      "Every agent runs in an isolated container on IBM Research infrastructure. Your code and credentials stay inside that container and are not shared with other agents or users.",
  },
  {
    question: "Does it keep running when I close the tab?",
    answer:
      "Yes. Scheduled agents run whether you are online or not. Results come back to you in Slack, Telegram, or the next time you open the platform.",
  },
  {
    question: "Can my team share an agent?",
    answer:
      "Yes. Agents can be shared with your team through a Slack channel. Everyone in the channel can talk to the agent and see its work.",
  },
  {
    question: "What does it cost?",
    answer:
      "The platform is available to IBM Research at no per-user charge. You bring your own model API key or use a shared one provided by your team.",
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
                ? "max-h-40 opacity-100"
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
