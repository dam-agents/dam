import { Search } from "@carbon/icons-react";
import type { ConnectionTemplateView, StarterKitView } from "api-server-api";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useStarterKits } from "../api/queries.js";
import {
  categoriesPresent,
  CATEGORY_LABEL,
  kitBadges,
  matchesSearch,
} from "../lib/catalog-cards.js";
import { kitIcon } from "../lib/kit-icon.js";

type Filter = StarterKitView["category"] | "all";

function KitBadges({
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

function Illustration({
  kit,
  className,
}: {
  kit: StarterKitView;
  className?: string;
}) {
  const Icon = kitIcon(kit);
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-accent/40 text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      <Icon size={32} />
    </div>
  );
}

function FeaturedCard({
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
  const Icon = kitIcon(kit);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`starter-kit-card-${kit.id}`}
      className="grid w-full overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-foreground/20 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <Illustration kit={kit} className="min-h-[180px]" />
      <div className="flex flex-col justify-center gap-3 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border">
            <Icon size={16} />
          </span>
          <h2 className="text-xl font-semibold text-foreground">{kit.name}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{kit.description}</p>
        <KitBadges
          kit={kit}
          templates={templates}
          templateById={templateById}
        />
      </div>
    </button>
  );
}

function KitCard({
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
      <Illustration kit={kit} className="h-[104px]" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base font-semibold text-foreground">{kit.name}</h3>
        <p className="flex-1 text-sm text-muted-foreground">
          {kit.description}
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

export function StarterKitsView() {
  const kits = useStarterKits();
  const templates = useConnectionTemplates();
  const setView = useStore((s) => s.setView);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const templateById = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );

  const all = useMemo(() => kits.data ?? [], [kits.data]);
  const shown = useMemo(
    () =>
      all.filter(
        (kit) =>
          (filter === "all" || kit.category === filter) &&
          matchesSearch(kit, query),
      ),
    [all, filter, query],
  );
  const [featured, ...rest] = shown;

  const tabs = useMemo(
    () => [
      { value: "all" as Filter, label: "All" },
      ...categoriesPresent(all).map((c) => ({
        value: c as Filter,
        label: CATEGORY_LABEL[c],
      })),
    ],
    [all],
  );

  return (
    <div>
      <PageHeader
        title="Starter Kits"
        description="Each starter kit bundles a harness, skills, schedules, and connections into a ready-made agent configuration."
        actions={
          <Button variant="outline" onClick={() => setView("coding-agent-new")}>
            Start from scratch
          </Button>
        }
      />

      {kits.isPending && <ListSkeleton rows={2} rowHeight={220} />}

      {kits.isError && (
        <Callout tone="danger">
          <p className="text-sm text-foreground">
            Couldn&apos;t load the starter kit catalog.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void kits.refetch()}
          >
            Retry
          </Button>
        </Callout>
      )}

      {kits.data && all.length === 0 && (
        <PageEmptyState
          title="No starter kits in this catalog"
          message="This install has no starter kit catalog configured, or the catalog lists no kits. You can still start from scratch."
          actionLabel="Start from scratch"
          onAction={() => setView("coding-agent-new")}
        />
      )}

      {kits.data && all.length > 0 && (
        <>
          <div className="relative mb-4">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search starter kits…"
              aria-label="Search starter kits"
              className="pl-9"
            />
          </div>

          {tabs.length > 2 && (
            <Tabs
              tabs={tabs}
              value={filter}
              onValueChange={setFilter}
              variant="pill"
              size="sm"
              ariaLabel="Filter kits by category"
              className="mb-5"
            />
          )}

          {shown.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              No presets match &quot;{query}&quot;
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {featured && (
                <FeaturedCard
                  kit={featured}
                  templates={templates.data ?? []}
                  templateById={templateById}
                  onOpen={() =>
                    navigateToStarterKit(featured.catalog, featured.id)
                  }
                />
              )}
              {rest.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {rest.map((kit) => (
                    <KitCard
                      key={`${kit.catalog}/${kit.id}`}
                      kit={kit}
                      templates={templates.data ?? []}
                      templateById={templateById}
                      onOpen={() => navigateToStarterKit(kit.catalog, kit.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
