import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";

import { CopyButton } from "@/components/ui/copy-button";
import { codeBlockText } from "@/lib/code-block-text";
import { cn } from "@/lib/utils";

type Props = ComponentPropsWithoutRef<"pre"> & ExtraProps;

export function MarkdownCodeBlock({ node, children, ...preProps }: Props) {
  const code = codeBlockText(node);

  return (
    <div className="code-block group/code-block relative">
      <pre {...preProps} className={cn("m-0", preProps.className)}>
        {children}
      </pre>
      {code !== "" && (
        <>
          <CopyButton
            value={code}
            label="Copy code"
            variant="outline"
            size="icon-sm"
            className="absolute right-2 top-2 transition-opacity hover-capable:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100"
          />
        </>
      )}
    </div>
  );
}
