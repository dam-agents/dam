import { ChevronLeft, ChevronRight } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

/** ‹ v3 / 5 › stepper for browsing an artifact's version history in the
 *  in-app previews (mirrors the share page's version nav). `current` and
 *  `total` are 1-based version numbers; renders nothing with a single
 *  version. */
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
    <div className="flex items-center gap-0.5 text-[12px] text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-xs"
        title="Older version"
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
        title="Newer version"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
