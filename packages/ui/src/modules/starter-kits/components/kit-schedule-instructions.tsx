import { Information } from "@carbon/icons-react";
import { useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";

export function KitScheduleInstructions({
  scheduleName,
  task,
}: {
  scheduleName: string;
  task: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="border-t border-kit-rule px-4 py-2">
        <DisclosureToggle
          open={open}
          onToggle={() => setOpen((o) => !o)}
          chevronSize={14}
          chevronClassName="text-muted-foreground"
          className="text-sm text-muted-foreground hover:text-foreground"
          testId={`starter-kit-schedule-instructions-${scheduleName}`}
        >
          Instructions
        </DisclosureToggle>
      </div>
      <div hidden={!open} className="px-4 pb-3">
        <div className="flex items-start gap-2.5 rounded-lg bg-kit-tint px-3 py-2.5">
          <Information size={16} className="mt-0.5 shrink-0 text-kit" />
          <p className="text-sm whitespace-pre-wrap text-foreground/80">
            {task}
          </p>
        </div>
      </div>
    </>
  );
}
