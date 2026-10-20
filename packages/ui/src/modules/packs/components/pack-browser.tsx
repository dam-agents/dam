import { Close, Search } from "@carbon/icons-react";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { Pack, PackCategory } from "../data/packs.js";
import { REAL_PACKS } from "../data/packs.js";

type Filter = PackCategory | "all";

const CATEGORY_ORDER: PackCategory[] = [
  "Software",
  "Productivity",
  "Knowledge",
  "Research",
  "Development",
];

interface PackBrowserProps {
  onSelect: (pack: Pack) => void;
  className?: string;
  compact?: boolean;
}

export function PackBrowser({
  onSelect,
  className,
  compact,
}: PackBrowserProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(() => {
    const present = new Set(REAL_PACKS.map((p) => p.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, []);

  const shown = useMemo(
    () =>
      REAL_PACKS.filter(
        (pack) =>
          (filter === "all" || pack.category === filter) &&
          (query === "" ||
            pack.name.toLowerCase().includes(query.toLowerCase()) ||
            pack.tagline.toLowerCase().includes(query.toLowerCase())),
      ),
    [filter, query],
  );

  const tabs: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    ...categories.map((c) => ({ value: c as Filter, label: c })),
  ];

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search starter kits…"
          aria-label="Search starter kits"
          className="pl-9 pr-9"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <Close size={16} />
          </Button>
        )}
      </div>

      {tabs.length > 2 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                filter === tab.value
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "grid gap-4",
          compact
            ? "grid-cols-1 sm:grid-cols-2"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {shown.map((pack) => (
          <button
            key={pack.id}
            type="button"
            onClick={() => onSelect(pack)}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-foreground/20"
          >
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  {pack.name}
                </h3>
                <Badge variant="muted" size="sm">
                  {pack.category}
                </Badge>
              </div>
              <p className="flex-1 text-sm text-muted-foreground">
                {pack.tagline}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {pack.required.map((slot) => (
                  <Badge key={slot.label} variant="muted" size="sm">
                    {slot.label}
                  </Badge>
                ))}
                {pack.included
                  .filter((slot) => slot.kind === "connection")
                  .map((slot) => (
                    <Badge key={slot.label} variant="muted" size="sm">
                      {slot.label}
                    </Badge>
                  ))}
              </div>
            </div>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No matching starter kits
        </p>
      )}
    </div>
  );
}
