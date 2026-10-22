import { useMemo } from "react";

import { HARNESS_ICONS, HARNESS_ORDER } from "@/components/harness-icons";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useCreateDefaultAgent } from "../../agents/hooks/use-create-default-agent.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useStarterKits } from "../api/queries.js";
import { CATEGORY_LABEL } from "../lib/catalog-cards.js";
import { KitCard, KitFilterBar, useKitFilter } from "./kit-browser.js";
import { KitLinkForm } from "./kit-link-form.js";

const DEFAULT_KIT = {
  name: "Generalist",
  text: "The vanilla option: only a harness without any preset. Use it directly, or as a foundation for a specialized agent.",
};

export function BrowseKitsModal() {
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const onClose = () => setKitBrowserOpen(false);
  return (
    <Modal size="lg" heightClass="h-[95dvh] md:h-[85vh]" onClose={onClose}>
      <DialogHeader
        title="Browse starter kits"
        subtitle="Pick a starter kit to create your agent from"
        onClose={onClose}
      />
      <DialogBody>
        <StarterKitCatalog onOpenKit={onClose} />
      </DialogBody>
    </Modal>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The starter kit catalog: search, category tabs,
 * the Generalist card and one card per kit. The Starter kits page and the
 * Browse starter kits dialog both show it.
 */
export function StarterKitCatalog({ onOpenKit }: { onOpenKit?: () => void }) {
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const defaultAgent = useCreateDefaultAgent();
  const kits = useStarterKits();
  const templates = useConnectionTemplates();
  const templateById = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );
  const all = useMemo(() => kits.data ?? [], [kits.data]);
  const { query, setQuery, filter, setFilter, shown, tabs } = useKitFilter(all);
  const showDefault =
    filter === "all" &&
    `${DEFAULT_KIT.name} ${DEFAULT_KIT.text}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());

  return (
    <>
      {kits.isPending && <ListSkeleton rows={2} rowHeight={180} />}

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

      {kits.data && (
        <>
          <KitFilterBar
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            tabs={tabs}
          />
          {shown.length === 0 && !showDefault ? (
            <div className="flex flex-wrap items-center gap-2 py-8 text-sm text-muted-foreground">
              <p>
                No starter kits
                {filter !== "all" && ` in ${CATEGORY_LABEL[filter]}`} match
                &quot;{query}&quot;
              </p>
              {filter !== "all" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilter("all")}
                >
                  Show all
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {showDefault && (
                <button
                  type="button"
                  onClick={() => void defaultAgent.create()}
                  disabled={!defaultAgent.ready}
                  data-testid="default-agent-card"
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 disabled:opacity-60"
                >
                  <h3 className="text-base font-semibold text-foreground">
                    {DEFAULT_KIT.name}
                  </h3>
                  <p className="flex-1 text-sm text-muted-foreground">
                    {DEFAULT_KIT.text}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {HARNESS_ORDER.map((harness) => {
                      const { Icon, label, fg } = HARNESS_ICONS[harness];
                      return (
                        <Badge
                          key={harness}
                          variant="muted"
                          size="sm"
                          className="gap-1.5"
                        >
                          <Icon
                            aria-hidden="true"
                            className={`size-3.5 ${fg}`}
                          />
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                </button>
              )}
              {shown.map((kit) => (
                <KitCard
                  key={`${kit.catalog}/${kit.id}`}
                  kit={kit}
                  templates={templates.data ?? []}
                  templateById={templateById}
                  onOpen={() => {
                    onOpenKit?.();
                    navigateToStarterKit(kit.catalog, kit.id);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
      <KitLinkForm onOpenKit={onOpenKit} />
    </>
  );
}
