import { Information } from "@carbon/icons-react";

import { HintTooltip } from "@/components/ui/tooltip";

export function HelpTip({ content }: { content: string }) {
  return (
    <HintTooltip label={content} content={content} side="bottom">
      <Information size={14} className="text-muted-foreground/60" />
    </HintTooltip>
  );
}
