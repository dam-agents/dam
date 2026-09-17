import { useMemo } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useStarterKits } from "../api/queries.js";
import {
  type Filter,
  KitCard,
  KitFilterBar,
  useKitFilter,
} from "./kit-browser.js";

export function BrowseKitsModal({
  onPick,
  onClose,
  onStartFromScratch,
  initialFilter = "all",
}: {
  onPick: (catalog: string, kitId: string) => void;
  onClose: () => void;
  onStartFromScratch: () => void;
  initialFilter?: Filter;
}) {
  const kits = useStarterKits();
  const templates = useConnectionTemplates();
  const templateById = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );
  const all = useMemo(() => kits.data ?? [], [kits.data]);
  const { query, setQuery, filter, setFilter, shown, tabs } = useKitFilter(
    all,
    initialFilter,
  );

  return (
    <Modal widthClass="w-[800px]" onClose={onClose}>
      <DialogHeader
        title="Browse Starter Kits"
        subtitle="Pick a starter kit to pre-fill your agent setup"
        onClose={onClose}
      />
      <DialogBody>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {shown.map((kit) => (
                  <KitCard
                    key={`${kit.catalog}/${kit.id}`}
                    kit={kit}
                    templates={templates.data ?? []}
                    templateById={templateById}
                    onOpen={() => onPick(kit.catalog, kit.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {kits.data && all.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">
            This install has no starter kit catalog configured.
          </p>
        )}
      </DialogBody>
      <DialogFooter divided>
        <Button variant="outline" onClick={onStartFromScratch}>
          Start from scratch instead
        </Button>
      </DialogFooter>
    </Modal>
  );
}
