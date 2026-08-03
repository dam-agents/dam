import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (!streaming && !userToggled.current) setOpen(false);
  }, [streaming]);

  const toggle = () => {
    userToggled.current = true;
    setOpen((o) => !o);
  };

  return (
    <ActivityBlock label="Thinking" open={open} onToggle={toggle}>
      <Markdown>{text}</Markdown>
    </ActivityBlock>
  );
}
