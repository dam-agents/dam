import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Markdown } from "../../../components/markdown.js";

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
    <div className="max-w-full">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 py-0.5 text-[12px] font-mono text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onClick={toggle}
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 opacity-50" />
        ) : (
          <ChevronRight size={11} className="shrink-0 opacity-50" />
        )}
        <span>Thinking</span>
      </button>
      {open && (
        <div className="mt-0.5 ml-4 pl-3 text-[12px] text-muted-foreground/70">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
