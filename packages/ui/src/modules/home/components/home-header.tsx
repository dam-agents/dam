import { ChevronDown } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  DIGEST_RANGE_OPTIONS,
  type DigestRange,
  useDigestRange,
} from "../home-digest-store.js";

export function HomeHeader() {
  const [range, setRange] = useDigestRange();
  const rangeLabel =
    DIGEST_RANGE_OPTIONS.find((o) => o.value === range)?.label ??
    "Since last visit";

  return (
    <header>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
          Home
        </h1>
        <RangeSelector range={range} label={rangeLabel} onSelect={setRange} />
      </div>
    </header>
  );
}

function RangeSelector({
  range,
  label,
  onSelect,
}: {
  range: DigestRange;
  label: string;
  onSelect: (r: DigestRange) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[14px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
        >
          {label}
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DIGEST_RANGE_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={cn(range === opt.value && "font-medium text-accent")}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
