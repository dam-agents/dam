import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function ComingSoonCard({
  name,
  description,
  icon,
}: {
  name: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="px-5 py-4 opacity-60">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg border bg-background flex items-center justify-center">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground mb-0.5">
            {name}
          </div>
          <div className="text-[12px] text-muted-foreground">{description}</div>
        </div>
      </div>
    </Card>
  );
}
