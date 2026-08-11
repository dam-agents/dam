import { ArrowRight, Close, Help } from "@carbon/icons-react";
import { useId, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { DOCS_URL } from "../constants.js";
import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";

export function DocsLauncher() {
  const titleId = useId();
  // The connection banner is a 44px bar in this same corner and outranks this
  // button, so step over it while it is up.
  const banner =
    useSyncExternalStore(subscribeApiHealth, getApiHealthSnapshot) !==
    "connected";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Help"
          className={cn(
            "fixed right-4 z-nav hidden h-[34px] w-[34px] md:inline-flex",
            banner ? "bottom-[60px]" : "bottom-4",
          )}
        >
          <Help size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        aria-labelledby={titleId}
        className="flex w-[300px] flex-col gap-2 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-bold text-foreground">
            Need help?
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
          Browse guides, references, and tutorials
        </p>
        <PopoverClose asChild>
          <a
            href={DOCS_URL}
            {...externalLinkProps}
            className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:underline"
          >
            Go to Documentation <ArrowRight size={16} />
          </a>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
