import { Renew as Loader } from "@carbon/icons-react";
import { useState } from "react";

import type { ToolChip as T } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

function stripFences(text: string): string {
  return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const hasContent = chip.content && chip.content.length > 0;
  const running = chip.status === "in_progress" || chip.status === "running";

  return (
    <ActivityBlock
      className={chip.status === "failed" ? "text-destructive" : undefined}
      label={
        <>
          {running && <Loader size={12} className="anim-spin shrink-0" />}
          <span className="truncate">{chip.title}</span>
        </>
      }
      onToggle={hasContent ? () => setOpen((o) => !o) : undefined}
      open={open}
    >
      {chip.content?.map((c, i) =>
        c.text ? (
          <pre
            key={i}
            className="py-1 text-[11px] font-mono whitespace-pre-wrap break-words overflow-x-auto w-full leading-[1.5]"
          >
            {stripFences(c.text)}
          </pre>
        ) : null,
      )}
    </ActivityBlock>
  );
}
