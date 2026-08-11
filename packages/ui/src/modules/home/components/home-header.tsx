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
  useDigestSince,
} from "../home-digest-store.js";
import { useDigestSummary } from "../home-summary-data.js";
import { formatDigestSince } from "../lib/format-time.js";

export function HomeHeader() {
  const digestSince = useDigestSince();
  const [range, setRange] = useDigestRange();
  const { data: summary } = useDigestSummary(digestSince);

  const sinceLabel = formatDigestSince(digestSince);
  const rangeLabel =
    DIGEST_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? "Since last visit";

  const parts: string[] = [];
  if (summary) {
    if (summary.blocked > 0)
      parts.push(`${summary.blocked} blocked`);
    if (summary.completed > 0)
      parts.push(`${summary.completed} completed`);
    if (summary.newArtifacts > 0)
      parts.push(
        `${summary.newArtifacts} new artifact${summary.newArtifacts > 1 ? "s" : ""}`,
      );
    if (summary.newLearnings > 0)
      parts.push(
        `${summary.newLearnings} new learning${summary.newLearnings > 1 ? "s" : ""}`,
      );
    if (summary.running > 0)
      parts.push(`${summary.running} running`);
  }

  const summaryLine = parts.length > 0 ? parts.join(", ") : null;

  return (
    <header className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
          Home
        </h1>
        <RangeSelector range={range} label={rangeLabel} onSelect={setRange} />
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <p className="text-[14px] text-muted-foreground">{sinceLabel}</p>
        {summaryLine && (
          <>
            <span className="text-[14px] text-muted-foreground">—</span>
            <p className="text-[14px] text-foreground">{summaryLine}</p>
          </>
        )}
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
