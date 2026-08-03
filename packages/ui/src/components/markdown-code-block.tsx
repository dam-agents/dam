import { Checkmark, Copy, Warning } from "@carbon/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { codeBlockText } from "@/lib/code-block-text";
import { cn } from "@/lib/utils";

const STATUS = {
  idle: "",
  copied: "Copied",
  failed: "Copy failed",
} as const;

type Props = ComponentPropsWithoutRef<"pre"> & ExtraProps;

export function MarkdownCodeBlock({ node, children, ...preProps }: Props) {
  const { copy, state } = useCopy();
  const code = codeBlockText(node);

  return (
    <div className="code-block group/code-block relative">
      <pre {...preProps} className={cn("m-0", preProps.className)}>
        {children}
      </pre>
      {code !== "" && (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => void copy(code)}
            aria-label="Copy code"
            title="Copy code"
            className={cn(
              // Gate the reveal on hover capability, not width: a touch device
              // wider than `md` would hide the button with no way to show it.
              "absolute right-2 top-2 transition-opacity",
              "hover-capable:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100",
              // The `outline` variant's own hover colour outranks these tints,
              // and after a click the pointer is still on the button.
              state === "copied" && "text-success hover:text-success",
              state === "failed" && "text-danger hover:text-danger",
            )}
          >
            {state === "copied" ? (
              <Checkmark size={14} />
            ) : state === "failed" ? (
              <Warning size={14} />
            ) : (
              <Copy size={14} />
            )}
          </Button>
          {/* A changing button name isn't reliably announced, so carry the
              outcome in a live region instead. */}
          <span role="status" aria-live="polite" className="sr-only">
            {STATUS[state]}
          </span>
        </>
      )}
    </div>
  );
}
