import { Checkmark, Copy } from "@carbon/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type HastElement = NonNullable<ExtraProps["node"]>;
type HastChild = HastElement["children"][number];

/** Raw source text of a rendered code block. rehype-highlight wraps every
 *  token in nested <span>s, so the text only exists at the leaves — walk the
 *  hast node instead of reading React children. */
export function codeBlockText(node: HastElement | undefined): string {
  if (!node) return "";
  // Strip all trailing newlines (LF or CRLF) so pasting into a terminal
  // doesn't auto-execute the last line.
  return collectText(node).replace(/[\r\n]+$/, "");
}

function collectText(node: HastElement | HastChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(collectText).join("");
  return "";
}

const LABELS = {
  idle: "Copy code",
  copied: "Copied",
  failed: "Copy failed",
} as const;

type MarkdownCodeBlockProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;

export function MarkdownCodeBlock({
  node,
  children,
  ...preProps
}: MarkdownCodeBlockProps) {
  const { copy, state } = useCopy();
  const code = codeBlockText(node);

  return (
    <div className="code-block group/code-block relative">
      <pre {...preProps} className={cn("m-0", preProps.className)}>
        {children}
      </pre>
      {code !== "" && (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => void copy(code)}
          aria-label={LABELS[state]}
          title={LABELS[state]}
          className={cn(
            "absolute right-2 top-2 transition-opacity opacity-100 md:opacity-0 md:group-hover/code-block:opacity-100 focus-visible:opacity-100",
            state === "copied" && "text-success",
            state === "failed" && "text-danger",
          )}
        >
          {state === "copied" ? <Checkmark size={14} /> : <Copy size={14} />}
        </Button>
      )}
    </div>
  );
}
