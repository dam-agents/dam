import { cn } from "@/lib/utils";

import type { Pack } from "../data/packs.js";

interface PackBrowserProps {
  onSelect: (pack: Pack) => void;
  className?: string;
  compact?: boolean;
}

export function PackBrowser({
  onSelect: _onSelect,
  className,
  compact: _compact,
}: PackBrowserProps) {
  return (
    <div className={cn("text-sm text-muted-foreground", className)}>
      Pack browser placeholder
    </div>
  );
}
