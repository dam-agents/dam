import { ArrowLeft } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../store.js";

const PLACEHOLDER_TEXTS = [
  {
    category: "Schedules",
    text: "Every Friday, file GitHub issues for usability problems raised in #team-help",
  },
  {
    category: "Skills",
    text: "Make a skill that prototypes GitHub issues and posts them to my Slack DMs for review",
  },
  {
    category: "Slack",
    text: "List this week’s bugs from #team-dev and who’s on each",
  },
  {
    category: "Artifacts",
    text: "Turn this research into a shareable report with charts",
  },
  {
    category: "Code",
    text: "Review every new pull request in our repo and leave comments",
  },
  {
    category: "Connections",
    text: "Add PRs waiting on me to my to-do list and DM it to me at 9am",
  },
  {
    category: "Memory",
    text: "Remember I like answers short and technical",
  },
];

export function PlaceholderTexts() {
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setView("chat")}
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-base font-semibold text-foreground">
          Rotating placeholder texts
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-[640px]">
          <p className="mb-8 text-sm text-muted-foreground">
            These rotate in the chat input when the user hasn't typed anything
            yet. Each one showcases a different capability.
          </p>
          <div className="flex flex-col gap-4">
            {PLACEHOLDER_TEXTS.map((item) => (
              <div
                key={item.category}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border border-border p-4",
                )}
              >
                <span className="text-sm font-medium text-muted-foreground">
                  {item.category}
                </span>
                <span className="text-sm text-foreground">
                  &ldquo;{item.text}&rdquo;
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
