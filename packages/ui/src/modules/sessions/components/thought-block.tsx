import { useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";

import { Markdown } from "../../../components/markdown.js";
import { ActivityBlock } from "./activity-block.js";

export function ThoughtBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(streaming);
  const userToggled = useRef(false);

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
