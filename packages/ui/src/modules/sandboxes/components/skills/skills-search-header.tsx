import { Search } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface SkillTotals {
  skills: number;
  sources: number;
  on: number;
}

/**
 * Search box over every skill the surface has loaded, plus the counts line
 * beneath it. The two live together because that line is also where a search
 * reports its result — a query matching nothing has nowhere else to say so.
 *
 * Rendered only while the sandbox is operable: searching a read-only snapshot
 * would be a live control on a dead surface.
 */
export function SkillsSearchHeader({
  query,
  onQueryChange,
  totals,
  /** Number of matches, or null when no query is active. */
  matchCount,
  /** Page-level notice (today: the drift banner). Sits between the box and the
   *  counts line, per the design — an alert about the whole sandbox belongs
   *  above the per-source cards, not inside one. */
  notice,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  totals: SkillTotals;
  matchCount: number | null;
  notice?: ReactNode;
}) {
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
      <p className="text-sm text-muted-foreground">
        {matchCount === null ? (
          <>
            {plural(totals.skills, "skill")} ·{" "}
            {plural(totals.sources, "connected source")} · {totals.on} on
          </>
        ) : (
          <>
            {plural(matchCount, "skill")}{" "}
            {matchCount === 1 ? "matches" : "match"} “{query}”
          </>
        )}
      </p>
    </div>
  );
}
