import { Search } from "@carbon/icons-react";
import type { ConnectionTemplateView, StarterKitView } from "api-server-api";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  categoriesPresent,
  CATEGORY_LABEL,
  kitBadges,
  matchesSearch,
} from "../lib/catalog-cards.js";
import { kitIcon } from "../lib/kit-icon.js";

export type Filter = StarterKitView["category"] | "all";

export function KitBadges({
  kit,
  templates,
  templateById,
}: {
  kit: StarterKitView;
  templates: readonly ConnectionTemplateView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kitBadges(kit, templates, templateById).map((badge) => (
        <Badge key={badge.key} variant="muted" size="sm">
          <span className="flex items-center gap-1.5">
            {badge.iconSlug && (
              <ConnectionIcon iconSlug={badge.iconSlug} alt="" size={14} />
            )}
            {badge.label}
          </span>
        </Badge>
      ))}
    </div>
  );
}

export function KitIllustration({
  kit,
  size = 32,
  className,
}: {
  kit: StarterKitView;
  size?: number;
  className?: string;
}) {
  const Icon = kitIcon(kit);
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-gradient-to-br from-kit-tint to-kit-surface text-kit",
        className,
      )}
      aria-hidden
    >
      <Icon size={size} />
    </div>
  );
}

export function KitCard({
  kit,
  templates,
  templateById,
  onOpen,
}: {
  kit: StarterKitView;
  templates: readonly ConnectionTemplateView[];
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`starter-kit-card-${kit.id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-foreground/20"
    >
      <KitIllustration
        kit={kit}
        className="h-[160px] border-b border-kit-line"
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base font-semibold text-foreground">{kit.name}</h3>
        <p className="flex-1 text-sm text-muted-foreground">
          {kit.tagline ?? kit.description}
        </p>
        <KitBadges
          kit={kit}
          templates={templates}
          templateById={templateById}
        />
      </div>
    </button>
  );
}

export function useKitFilter(
  kits: readonly StarterKitView[],
  initial: Filter = "all",
) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initial);

  const shown = useMemo(
    () =>
      kits.filter(
        (kit) =>
          (filter === "all" || kit.category === filter) &&
          matchesSearch(kit, query),
      ),
    [kits, filter, query],
  );

  const tabs = useMemo(
    () => [
      { value: "all" as Filter, label: "All" },
      ...categoriesPresent(kits).map((c) => ({
        value: c as Filter,
        label: CATEGORY_LABEL[c],
      })),
    ],
    [kits],
  );

  return { query, setQuery, filter, setFilter, shown, tabs };
}

export function KitFilterBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  tabs,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  tabs: readonly { value: Filter; label: string }[];
}) {
  return (
    <>
      <div className="relative mb-4">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search starter kits…"
          aria-label="Search starter kits"
          className="pl-9"
        />
      </div>
      {tabs.length > 2 && (
        <Tabs
          tabs={tabs}
          value={filter}
          onValueChange={onFilterChange}
          variant="pill"
          size="sm"
          ariaLabel="Filter kits by category"
          className="mb-5"
        />
      )}
    </>
  );
}
