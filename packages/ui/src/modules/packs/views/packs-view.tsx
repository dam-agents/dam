import { Search } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import {
  type Pack,
  PACK_CATEGORIES,
  type PackCategory,
  PACKS,
} from "../data/packs.js";

type CategoryFilter = "All" | PackCategory;

const CATEGORY_TABS: readonly TabDef<CategoryFilter>[] = [
  { value: "All", label: "All" },
  ...PACK_CATEGORIES.map((c) => ({ value: c as CategoryFilter, label: c })),
];

export function PacksView() {
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [search, setSearch] = useState("");
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const filtered = useMemo(() => {
    let result = PACKS as Pack[];
    if (category !== "All") {
      result = result.filter((p) => p.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q),
      );
    }
    return result;
  }, [category, search]);

  const isEmpty = PACKS.length === 0;
  const isFilteredEmpty = !isEmpty && filtered.length === 0;

  return (
    <>
      <PageHeader
        title="Packs"
        description="Pre-configured agent setups you can apply in one click. Each pack bundles a harness, skills, schedules, and connections."
        actions={
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search packs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-56 pl-9"
            />
          </div>
        }
      />

      <Tabs
        tabs={CATEGORY_TABS}
        value={category}
        onValueChange={setCategory}
        variant="pill"
        size="sm"
        ariaLabel="Filter packs by category"
        className="mb-6"
      />

      {isEmpty ? (
        <PageEmptyState
          title="No packs yet"
          message="Packs are pre-configured agent setups that bundle a harness, skills, schedules, and connections. Check back soon."
          actionLabel="Create agent"
          onAction={() => {}}
        />
      ) : isFilteredEmpty ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No packs match your search
            {category !== "All" ? ` in ${category}` : ""}.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              onSelect={() => setSelectedPack(pack)}
            />
          ))}
        </div>
      )}

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
      />
    </>
  );
}

function PackCard({ pack, onSelect }: { pack: Pack; onSelect: () => void }) {
  const Icon = pack.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "flex flex-col gap-3 p-5 text-left",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Icon size={16} className="text-foreground" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{pack.name}</h3>
          <Badge variant="muted" size="sm" className="mt-0.5">
            {pack.category}
          </Badge>
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-muted-foreground">
        {pack.tagline}
      </p>

      <div className="mt-auto flex items-center gap-3 text-[14px] text-muted-foreground">
        <span>{pack.included.length} included</span>
        <span className="text-border">|</span>
        <span>{pack.required.length} to set up</span>
      </div>
    </button>
  );
}
