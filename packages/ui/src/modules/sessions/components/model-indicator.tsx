import { ArrowRight, Close } from "@carbon/icons-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
  model: string;
  subject: string;
  settings?: {
    label: string;
    onConfigure: () => void;
  };
}

function friendlyModelName(slug: string): string {
  const lower = slug.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("sonnet")) return "Sonnet";
  if (lower.includes("haiku")) return "Haiku";
  if (lower.includes("fable")) return "Fable";
  return slug;
}

export function ModelIndicator({ model, subject, settings }: Props) {
  const titleId = useId();
  const displayName = friendlyModelName(model);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {displayName}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={titleId}
        className="flex w-[300px] flex-col gap-2 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-bold text-foreground">
            Current model
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
            >
              <Close size={16} />
            </Button>
          </PopoverClose>
        </div>
        <p className="text-muted-foreground">
          This {subject} is using{" "}
          <span className="text-foreground">{model}</span>
          {settings ? `. Change the model in ${settings.label}.` : "."}
        </p>
        {settings && (
          <PopoverClose asChild>
            <button
              type="button"
              onClick={settings.onConfigure}
              className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:underline"
            >
              Configure model <ArrowRight size={16} />
            </button>
          </PopoverClose>
        )}
      </PopoverContent>
    </Popover>
  );
}
