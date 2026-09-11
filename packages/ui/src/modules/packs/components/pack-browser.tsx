import { Close, Search } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { Pack, PackCategory } from "../data/packs.js";
import { usePacks } from "../hooks/use-packs.js";
import { PackIngredientSummary } from "./pack-ingredient-summary.js";

type CategoryFilter = "All" | PackCategory;

interface PackBrowserProps {
  onSelect: (pack: Pack) => void;
  className?: string;
  scrollClassName?: string;
  compact?: boolean;
}

export function PackBrowser({
  onSelect,
  className,
  scrollClassName,
  compact,
}: PackBrowserProps) {
  const packs = usePacks();
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;

  const categoryTabs = useMemo<TabDef<CategoryFilter>[]>(() => {
    const unique = [...new Set(packs.map((p) => p.category))];
    return [
      { value: "All", label: "All" },
      ...unique.map((c) => ({ value: c as CategoryFilter, label: c })),
    ];
  }, [packs]);

  const activeCategory =
    category === "All" || packs.some((p) => p.category === category)
      ? category
      : "All";

  const filtered = useMemo(() => {
    let result = packs as Pack[];
    if (!isSearching && activeCategory !== "All") {
      result = result.filter((p) => p.category === activeCategory);
    }
    if (isSearching) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [packs, activeCategory, search, isSearching]);

  const isFilteredEmpty = filtered.length === 0;

  return (
    <div className={className}>
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search starter kits..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn("h-9 pl-9", isSearching && "pr-9")}
        />
        {isSearching && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Close size={16} />
          </button>
        )}
      </div>
      {!isSearching && (
        <Tabs
          tabs={categoryTabs}
          value={activeCategory}
          onValueChange={setCategory}
          variant="pill"
          size="sm"
          ariaLabel="Filter starter kits by category"
          className="mt-3"
        />
      )}

      <div className="pt-4" />
      <div className={scrollClassName}>
        {isFilteredEmpty ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {isSearching
                ? `No starter kits match "${search.trim()}"`
                : `No starter kits in ${activeCategory}`}
            </p>
          </div>
        ) : isSearching ? (
          <PackGrid packs={filtered} onSelect={onSelect} />
        ) : (
          <SpotlightLayout
            packs={filtered}
            onSelect={onSelect}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}

export function PackGrid({
  packs,
  onSelect,
}: {
  packs: Pack[];
  onSelect: (p: Pack) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {packs.map((pack) => {
        const Icon = pack.icon;
        return (
          <button
            key={pack.id}
            type="button"
            aria-label={pack.name}
            onClick={() => onSelect(pack)}
            className={cn(
              CARD_SURFACE,
              CARD_HOVER,
              "flex flex-col overflow-hidden text-left",
            )}
          >
            <div className="flex h-36 w-full items-center justify-center bg-preset-light">
              <Icon size={32} className="text-preset/40" />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h4 className="text-base font-semibold text-foreground">
                {pack.name}
              </h4>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {pack.tagline}
              </p>
              <div className="mt-4">
                <PackIngredientSummary pack={pack} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SpotlightLayout({
  packs,
  onSelect,
  compact,
}: {
  packs: Pack[];
  onSelect: (p: Pack) => void;
  compact?: boolean;
}) {
  const [hero, ...rest] = packs;
  if (!hero) return null;

  const Icon = hero.icon;

  if (compact) {
    return (
      <div className="flex flex-col gap-4">
        <PackGrid packs={packs} onSelect={onSelect} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        aria-label={hero.name}
        onClick={() => onSelect(hero)}
        className={cn(
          CARD_SURFACE,
          CARD_HOVER,
          "grid grid-cols-1 overflow-hidden text-left md:grid-cols-2",
        )}
      >
        <div className="flex min-h-[280px] items-center justify-center bg-gradient-to-br from-preset-light to-card">
          <Icon size={48} className="text-preset/40" />
        </div>
        <div className="flex flex-col justify-center p-8 md:p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              <Icon size={16} className="text-foreground" />
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              {hero.name}
            </h3>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {hero.tagline}
          </p>
          <div className="mt-5">
            <PackIngredientSummary pack={hero} />
          </div>
        </div>
      </button>
      {rest.length > 0 && <PackGrid packs={rest} onSelect={onSelect} />}
    </div>
  );
}
