import type { ConnectionTemplateView, StarterKitView } from "api-server-api";
import { useEffect, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useStarterKits } from "../api/queries.js";
import {
  KitBadges,
  KitCard,
  KitFilterBar,
  KitIllustration,
  useKitFilter,
} from "../components/kit-browser.js";
import { kitIcon } from "../lib/kit-icon.js";

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
      <KitIllustration
        kit={kit}
        size={48}
        className="min-h-[280px] border-kit-line md:border-r"
      />
      <div className="flex flex-col justify-center gap-3 p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border border-border">
            <Icon size={18} />
          </span>
          <h2 className="text-2xl font-semibold text-foreground">{kit.name}</h2>
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

export function StarterKitsView() {
  const kits = useStarterKits();
  const templates = useConnectionTemplates();
  const setView = useStore((s) => s.setView);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const category = useStore((s) => s.starterKitCategory);
  const templateById = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );

  const all = useMemo(() => kits.data ?? [], [kits.data]);
  const { query, setQuery, filter, setFilter, shown, tabs } = useKitFilter(
    all,
    category ?? "all",
  );
  useEffect(() => setFilter(category ?? "all"), [category, setFilter]);
  const [featured, ...rest] = shown;

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
          <KitFilterBar
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            tabs={tabs}
          />

          {shown.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              No starter kits match &quot;{query}&quot;
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
