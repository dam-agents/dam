import { useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";

import { Markdown } from "../../../components/markdown.js";
import { useStore } from "../../../store.js";
import { ActivityBlock } from "./activity-block.js";

/** The last line of the thoughts that holds text: what the model is on now. */
export function latestThoughtLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return "";
}

export function ThoughtBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const expandWhileStreaming = useStore(
    (s) => s.thinkingExpandedWhileStreaming,
  );
  const [open, setOpen] = useState(streaming && expandWhileStreaming);
  const userToggled = useRef(false);

  useEffect(() => {
    if (!streaming && !userToggled.current) setOpen(false);
  }, [streaming]);

  const toggle = () => {
    userToggled.current = true;
    setOpen((o) => !o);
  };

  const preview = streaming && !open ? latestThoughtLine(text) : "";

  return (
    <ActivityBlock
      label={
        preview ? (
          <span className="flex min-w-0 flex-1 items-start gap-1.5">
            <span className="shrink-0">Thinking</span>
            <span
              className="min-w-0 truncate text-foreground"
              data-testid="thought-preview"
              title={preview}
            >
              {preview}
            </span>
          </span>
        ) : (
          "Thinking"
        )
      }
      open={open}
      onToggle={toggle}
      actions={
        <CopyButton
          value={text}
          label="Copy thoughts"
          stopPropagation
          className={HOVER_ACTION}
        />
      }
    >
      <Markdown>{text}</Markdown>
    </ActivityBlock>
  );
}
