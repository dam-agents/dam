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
import { IllustrationPartsSheet } from "../components/illustration-parts-sheet.js";
import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import { PackIngredientSummary } from "../components/pack-ingredient-summary.js";
import { categoryColors, type Pack, type PackCategory } from "../data/packs.js";
import { usePacks } from "../hooks/use-packs.js";
import { createDemoAgent } from "../lib/create-demo-agent.js";
import { seedDemoChat } from "../lib/seed-demo-chat.js";

type CategoryFilter = "All" | PackCategory;

export function PacksView() {
  const packs = usePacks();
  const [category, setCategory] = useState<CategoryFilter>("All");

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
  const [search, setSearch] = useState("");
  const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
  const [showIllustrationParts, setShowIllustrationParts] = useState(false);

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

  const isEmpty = packs.length === 0;
  const isFilteredEmpty = !isEmpty && filtered.length === 0;

  return (
    <>
      <PageHeader
        title="Starter Kits"
        description="Pre-configured agent setups you can apply in one click. Each starter kit bundles skills, schedules, and connections."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowIllustrationParts(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Illustration parts
            </button>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search starter kits..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56 pl-9"
              />
            </div>
          </div>
        }
      />

      {!isSearching && (
        <Tabs
          tabs={categoryTabs}
          value={activeCategory}
          onValueChange={setCategory}
          variant="pill"
          size="sm"
          ariaLabel="Filter starter kits by category"
          className="mb-6"
        />
      )}

      {isEmpty ? (
        <PageEmptyState
          title="No starter kits yet"
          message="Starter kits are pre-configured agent setups that bundle skills, schedules, and connections. Check back soon."
          actionLabel="Create agent"
          onAction={() => {}}
        />
      ) : isFilteredEmpty ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {isSearching
              ? `No starter kits match "${search.trim()}"`
              : `No starter kits in ${activeCategory}`}
          </p>
        </div>
      ) : isSearching || activeCategory !== "All" ? (
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

      {showIllustrationParts && (
        <IllustrationPartsSheet
          onClose={() => setShowIllustrationParts(false)}
        />
      )}
    </>
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
      {packs.map((pack) => (
        <button
          key={pack.id}
          type="button"
          onClick={() => onSelect(pack)}
          className={cn(
            CARD_SURFACE,
            CARD_HOVER,
            "flex flex-col overflow-hidden p-5 text-left",
          )}
        >
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-foreground">
              {pack.name}
            </h4>
            <CategoryChip category={pack.category} />
          </div>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
            {pack.tagline}
          </p>
          <div className="mt-4">
            <PackIngredientSummary pack={pack} />
          </div>
        </button>
      ))}
    </div>
  );
}

function CategoryChip({ category }: { category: PackCategory }) {
  const colors = categoryColors(category);
  return (
    <Badge
      style={{ background: colors.light, color: colors.fg }}
      className="border-transparent"
    >
      {category}
    </Badge>
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

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => onSelect(hero)}
        className={cn(
          CARD_SURFACE,
          CARD_HOVER,
          "min-h-[280px] overflow-hidden p-8 text-left md:p-10",
        )}
      >
        <div className="flex items-center gap-3">
          <h3 className="text-2xl font-bold tracking-tight text-foreground">
            {hero.name}
          </h3>
          <CategoryChip category={hero.category} />
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {hero.tagline}
        </p>
        <div className="mt-5">
          <PackIngredientSummary pack={hero} />
        </div>
      </button>

      {rest.length > 0 && <PackGrid packs={rest} onSelect={onSelect} />}
    </div>
  );
}
