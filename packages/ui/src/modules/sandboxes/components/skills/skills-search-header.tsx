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
  actions,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  totals: SkillTotals;
  matchCount: number | null;
  notice?: ReactNode;
  /** Sandbox-level skill actions, on the counts row per the design. */
  actions?: ReactNode;
}) {
  const countsText =
    matchCount === null
      ? `${plural(totals.skills, "skill")} · ${plural(totals.sources, "connected source")} · ${totals.on} on`
      : `${plural(matchCount, "skill")} ${matchCount === 1 ? "matches" : "match"} “${query}”`;
  // Announced from a hidden region fed by a debounced copy: the visible line
  // updates per keystroke, and a live region doing the same would queue one
  // announcement per letter instead of reporting the settled result.
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
        {/* Announced, because this line is the only report a search produces:
            sections silently vanishing from the page tell a screen-reader user
            nothing about whether the query matched 40 skills or none. */}
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
