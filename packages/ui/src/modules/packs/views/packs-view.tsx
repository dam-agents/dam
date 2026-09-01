import { Search } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import {
  type Pack,
  PACK_CATEGORIES,
  type PackCategory,
  PACKS,
} from "../data/packs.js";
import { createDemoAgent } from "../lib/create-demo-agent.js";
import { seedDemoChat } from "../lib/seed-demo-chat.js";

type CategoryFilter = "All" | PackCategory;

const CATEGORY_TABS: readonly TabDef<CategoryFilter>[] = [
  { value: "All", label: "All" },
  ...PACK_CATEGORIES.map((c) => ({ value: c as CategoryFilter, label: c })),
];

export function PacksView() {
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [search, setSearch] = useState("");
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);

  const setView = useStore((s) => s.setView);
  const setPendingPack = useStore((s) => s.setPendingPack);
  const selectAgent = useStore((s) => s.selectAgent);
  const demoAgents = useStore((s) => s.demoAgents);

  const handleCreateFromPack = (pack: Pack) => {
    setSelectedPack(null);
    setPendingPack(pack);
    setView("agent-new");
  };

  const handleTryIt = (pack: Pack) => {
    setSelectedPack(null);
    const existingDemoId = demoAgents.get(pack.id);
    if (existingDemoId) {
      selectAgent(existingDemoId);
      seedDemoChat(pack);
      return;
    }
    const agentId = createDemoAgent(pack);
    selectAgent(agentId);
    seedDemoChat(pack);
  };

  const isSearching = search.trim().length > 0;

  const filtered = useMemo(() => {
    let result = PACKS as Pack[];
    if (!isSearching && category !== "All") {
      result = result.filter((p) => p.category === category);
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
  }, [category, search, isSearching]);

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

      {!isSearching && (
        <Tabs
          tabs={CATEGORY_TABS}
          value={category}
          onValueChange={setCategory}
          variant="pill"
          size="sm"
          ariaLabel="Filter packs by category"
          className="mb-6"
        />
      )}

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
            {isSearching
              ? `No packs match "${search.trim()}"`
              : `No packs in ${category}`}
          </p>
        </div>
      ) : isSearching ? (
        <PackGrid packs={filtered} onSelect={setSelectedPack} />
      ) : (
        <SpotlightLayout packs={filtered} onSelect={setSelectedPack} />
      )}

      <PackDetailSheet
        pack={selectedPack}
        onClose={() => setSelectedPack(null)}
        onCreateFromPack={handleCreateFromPack}
        onTryIt={handleTryIt}
      />
    </>
  );
}

function IngredientPills({ pack }: { pack: Pack }) {
  return (
    <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
      <span>{pack.included.length} included</span>
      <span className="text-border">|</span>
      <span>{pack.required.length} to set up</span>
    </div>
  );
}

function PackGrid({
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
            onClick={() => onSelect(pack)}
            className={cn(
              CARD_SURFACE,
              CARD_HOVER,
              "flex flex-col overflow-hidden text-left",
            )}
          >
            <div className="h-36 w-full bg-muted" />
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                  <Icon size={16} className="text-foreground" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-foreground">
                    {pack.name}
                  </h4>
                  <Badge variant="muted" size="sm" className="mt-0.5">
                    {pack.category}
                  </Badge>
                </div>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                {pack.tagline}
              </p>
              <div className="mt-4">
                <IngredientPills pack={pack} />
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
}: {
  packs: Pack[];
  onSelect: (p: Pack) => void;
}) {
  const [hero, ...rest] = packs;
  if (!hero) return null;

  const HeroIcon = hero.icon;

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onSelect(hero)}
        className={cn(
          CARD_SURFACE,
          CARD_HOVER,
          "grid grid-cols-1 overflow-hidden text-left md:grid-cols-2",
        )}
      >
        <div className="min-h-[280px] bg-muted" />
        <div className="flex flex-col justify-center p-8 md:p-10">
          <Badge variant="muted" className="w-fit">
            Featured
          </Badge>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              <HeroIcon size={16} className="text-foreground" />
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              {hero.name}
            </h3>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {hero.tagline}
          </p>
          <div className="mt-5">
            <IngredientPills pack={hero} />
          </div>
        </div>
      </button>

      {rest.length > 0 && <PackGrid packs={rest} onSelect={onSelect} />}
    </div>
  );
}
