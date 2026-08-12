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
  /** What this surface calls the thing that owns the model — "sandbox" or
   *  "knowledge base" — so the copy reads in the user's own terms. */
  subject: string;
  /** Where the model is actually changed, named as the page is titled. */
  settingsLabel: string;
  onConfigure: () => void;
}

/**
 * The model the sandbox is running, under the composer (#3057).
 *
 * It used to navigate straight to configuration on click, which threw the user
 * out of the conversation they were reading. It now says what the model is and
 * offers the trip, so leaving is a choice rather than a surprise.
 */
export function ModelIndicator({
  model,
  subject,
  settingsLabel,
  onConfigure,
}: Props) {
  const titleId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {model}
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
          <span className="text-foreground">{model}</span>. Change the model in{" "}
          {settingsLabel}.
        </p>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={onConfigure}
            className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:underline"
          >
            Configure model <ArrowRight size={16} />
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
