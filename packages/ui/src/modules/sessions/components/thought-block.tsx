import { Brain, ChevronDown, ChevronRight } from "lucide-react";
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
    <div className="text-[12px] max-w-full">
      <button
        className="flex items-center gap-1.5 py-1 px-2 rounded-md border border-border-light bg-surface text-text-muted cursor-pointer hover:bg-surface-raised"
        onClick={toggle}
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
        <Brain size={12} className="shrink-0" />
        <span className="font-semibold">Thinking</span>
      </button>
      {open && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-surface-raised border border-border-light opacity-70 text-[13px]">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
