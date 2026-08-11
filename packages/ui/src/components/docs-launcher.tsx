import { ArrowRight, Close, Help } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { externalLinkProps } from "@/lib/external-link";

import { DOCS_URL } from "../constants.js";

export function DocsLauncher() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Help"
          className="fixed bottom-4 right-4 z-nav hidden h-[34px] w-[34px] md:inline-flex"
        >
          <Help size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="flex w-[300px] flex-col gap-2 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-bold text-foreground">Need help?</h2>
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
