import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

export function VersionSwitcher({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (version: number) => void;
}) {
  if (total < 2) return null;
  return (
    <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Older version"
        tooltip="Older version"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      <span className="min-w-[52px] text-center tabular-nums">
        v{current} / {total}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Newer version"
        tooltip="Newer version"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
