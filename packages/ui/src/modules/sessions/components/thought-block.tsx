import {
  ChevronDown,
  ChevronRight,
  MachineLearning as Brain,
} from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

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
      <Button
        variant="outline"
        size="sm"
        className="h-auto gap-1.5 py-1 px-2 text-muted-foreground cursor-pointer"
        onClick={toggle}
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0" />
        ) : (
          <ChevronRight size={12} className="shrink-0" />
        )}
        <Brain size={12} className="shrink-0" />
        <span className="font-semibold">Thinking</span>
      </Button>
      {open && (
        <div className="mt-1 px-3 py-1.5 rounded-lg bg-muted border border-border opacity-70 text-[13px]">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
