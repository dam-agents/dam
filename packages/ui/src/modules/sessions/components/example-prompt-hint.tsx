import { cn } from "@/lib/utils";

import type { RotatingExample } from "../hooks/use-rotating-example.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the example prompt drawn over an empty composer,
 * with the Tab key that puts it in. It sits where the placeholder would, takes
 * no clicks, fades between examples as they rotate, and is hidden from screen
 * readers, which read the composer's own placeholder.
 */
export function ExamplePromptHint({ example }: { example: RotatingExample }) {
  return (
    <span
      aria-hidden
      data-testid="example-prompt"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-[17px] flex items-center justify-between gap-2 pr-2 text-sm leading-[22px] transition-opacity duration-500",
        example.fading && "opacity-0",
      )}
    >
      <span className="truncate text-muted-foreground">{example.text}</span>
      <kbd
        data-testid="example-prompt-tab"
        className="inline-flex h-5 shrink-0 items-center rounded border border-border px-1.5 font-sans text-2xs text-muted-foreground"
      >
        Tab
      </kbd>
    </span>
  );
}
