import { Checkmark, Copy, Warning } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

import { Markdown } from "../../../components/markdown.js";
import { ActivityBlock } from "./activity-block.js";

export function ThoughtBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(true);
  const userToggled = useRef(false);
  const { copy, copied, state: copyState } = useCopy();

  useEffect(() => {
    if (!streaming && !userToggled.current) setOpen(false);
  }, [streaming]);

  const toggle = () => {
    userToggled.current = true;
    setOpen((o) => !o);
  };

  return (
    <ActivityBlock
      label="Thinking"
      open={open}
      onToggle={toggle}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy thoughts"}
          tooltip={copied ? "Copied" : "Copy thoughts"}
          onClick={(e) => {
            e.stopPropagation();
            void copy(text);
          }}
          className={cn(
            "text-muted-foreground hover:text-foreground",
            HOVER_ACTION,
            copied && "text-success hover:text-success opacity-100",
            copyState === "failed" &&
              "text-danger hover:text-danger opacity-100",
          )}
        >
          {copied ? (
            <Checkmark size={12} />
          ) : copyState === "failed" ? (
            <Warning size={12} />
          ) : (
            <Copy size={12} />
          )}
        </Button>
      }
    >
      <Markdown>{text}</Markdown>
    </ActivityBlock>
  );
}
