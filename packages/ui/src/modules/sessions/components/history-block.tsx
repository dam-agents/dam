import { useState } from "react";

import { ActivityBlock } from "./activity-block.js";

export function HistoryBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <ActivityBlock
      label="Conversation history"
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div className="whitespace-pre-wrap break-words">{text}</div>
    </ActivityBlock>
  );
}
