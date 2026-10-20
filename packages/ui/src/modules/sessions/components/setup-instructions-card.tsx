import { useState } from "react";

import { getBrand } from "../../../brand.js";
import type { Message } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

export function SetupInstructionsCard({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const text = message.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n\n");
  return (
    <div data-testid="setup-instructions" className="anim-in">
      <ActivityBlock
        label={`Setup instructions sent by ${getBrand().name}`}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      >
        <div className="whitespace-pre-wrap break-words select-text">
          {text}
        </div>
      </ActivityBlock>
    </div>
  );
}
