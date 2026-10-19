import { Information } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

export function HelpTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} side="bottom">
      <Information size={14} className="cursor-help text-muted-foreground/60" />
    </Tooltip>
  );
}
