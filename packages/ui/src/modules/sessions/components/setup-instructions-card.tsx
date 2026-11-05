import type { SessionPurpose } from "agent-runtime-api";
import { useState } from "react";

import { getBrand } from "../../../brand.js";
import type { Message } from "../../../types.js";
import { ActivityBlock } from "./activity-block.js";

const LABELS: Record<SessionPurpose, string> = {
  "cost-review": "Cost review request",
};

export function SetupInstructionsCard({
  message,
  purpose,
}: {
  message: Message;
  purpose?: SessionPurpose | undefined;
}) {
  const [open, setOpen] = useState(false);
  const text = message.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n\n");
  return (
    <div data-testid="setup-instructions" className="anim-in">
      <ActivityBlock
        label={`${purpose ? LABELS[purpose] : "Setup instructions"} sent by ${getBrand().name}`}
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
