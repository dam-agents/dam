import { Search } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface SkillTotals {
  skills: number;
  sources: number;
  on: number;
}

export function SkillsSearchHeader({
  query,
  onQueryChange,
  totals,
  matchCount,
  notice,
  actions,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  totals: SkillTotals;
  matchCount: number | null;
  notice?: ReactNode;
  actions?: ReactNode;
}) {
  const countsText =
    matchCount === null
      ? `${plural(totals.skills, "skill")} · ${plural(totals.sources, "connected source")} · ${totals.on} on`
      : `${plural(matchCount, "skill")} ${matchCount === 1 ? "matches" : "match"} “${query}”`;
  const announced = useDebouncedValue(countsText, 300);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search skills across all connected sources…"
          aria-label="Search skills"
          className="pl-9"
        />
      </div>
      {notice}
      <div className="flex items-center justify-between gap-3">
        {}
        <p className="text-sm text-muted-foreground">{countsText}</p>
        <p role="status" aria-live="polite" className="sr-only">
          {announced}
        </p>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
