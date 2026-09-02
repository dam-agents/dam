import { useMemo, useState } from "react";

import { ListSkeleton } from "@/components/list-skeleton";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";

import { useAppConnections } from "../../connections/api/queries.js";
import { CardIconTile } from "../../sandboxes/components/steps/stacked-card.js";
import {
  ApplyPackModal,
  type ApplyResult,
} from "../components/apply-pack-modal.js";
import { MakeMineModal } from "../components/make-mine-modal.js";
import { PackDemoView } from "../components/pack-demo-view.js";
import { PackDetailSheet } from "../components/pack-detail-sheet.js";
import {
  INGREDIENT_ICON,
  ingredientCounts,
  type Pack,
  PACK_FACETS,
  type PackFacet,
  PACKS,
} from "../data/packs.js";

type Filter = PackFacet | "All";

/**
 * Applying is additive, so the preview splits the pack three ways: what lands on
 * the agent, what is left alone because the agent already has it, and the slots
 * the user fills in. A slot is never "added" — applying cannot pick a repo or a
 * channel for someone — and an unfilled slot never blocks applying.
 *
 * Which *included* ingredients collide is a server answer. Here the first one
 * stands in for a collision, so that state is reachable in the prototype.
 */
function previewApply(
  pack: Pack,
  connectedTemplateIds: ReadonlySet<string>,
): ApplyResult {
  const collision = pack.included[0];
  const added: ApplyResult["added"] = pack.included
    .slice(1)
    .map((item) => ({ kind: item.kind, name: item.name }));
  const skipped: ApplyResult["skipped"] = collision
    ? [
        {
          kind: collision.kind,
          name: collision.name,
          skip: "already-on-agent" as const,
        },
      ]
    : [];

  const toFill: ApplyResult["toFill"] = pack.slots.map((slot) => ({
    kind: slot.kind,
    name: slot.label,
    note:
      slot.templateIds?.some((id) => connectedTemplateIds.has(id)) === true
        ? "You have one of these — pick it on the agent"
        : undefined,
  }));

  return { added, skipped, toFill };
}

function IngredientCounts({ pack }: { pack: Pack }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {ingredientCounts(pack).map(({ kind, count, label }) => {
        const Icon = INGREDIENT_ICON[kind];
        return (
          <span key={kind} className="flex items-center gap-1">
            <Icon className="size-3.5" />
            {count} {label}
          </span>
        );
      })}
    </div>
  );
}

function PackGrid({
  packs,
  onSelect,
}: {
  packs: Pack[];
  onSelect: (pack: Pack) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
      {packs.map((pack) => {
        const Icon = pack.icon;
        return (
          <button
            key={pack.id}
            type="button"
            onClick={() => onSelect(pack)}
            aria-label={pack.name}
            className="flex flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-foreground/20"
          >
            <CardIconTile icon={Icon} />
            <h3 className="mt-4 text-base font-semibold text-foreground">
              {pack.name}
            </h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
              {pack.tagline}
            </p>
            <div className="mt-4">
              <IngredientCounts pack={pack} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  /** Packs are static today. The prop exists so the empty and loading states are reachable. */
  packs?: Pack[];
  loading?: boolean;
  onCreate?: (pack: Pack) => void;
  /** When set, a pack can be applied to this agent instead of creating one. */
  applyTo?: { id: string; name: string };
}

export function PacksView({
  packs = PACKS,
  loading = false,
  onCreate,
  applyTo,
}: Props) {
  const connectionsQ = useAppConnections();
  const connectedTemplateIds = useMemo(
    () =>
      new Set(
        (connectionsQ.data ?? [])
          .filter((c) => c.status === "active")
          .map((c) => c.templateId),
      ),
    [connectionsQ.data],
  );

  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<Pack | null>(null);
  const [demo, setDemo] = useState<Pack | null>(null);
  const [applying, setApplying] = useState<Pack | null>(null);
  const [makingMine, setMakingMine] = useState<Pack | null>(null);

  if (demo) {
    return (
      <>
        <PackDemoView
          pack={demo}
          onBack={() => setDemo(null)}
          onMakeMine={setMakingMine}
        />
        {makingMine && (
          <MakeMineModal
            pack={makingMine}
            onClose={() => setMakingMine(null)}
            onConfirm={() => {
              setMakingMine(null);
              setDemo(null);
              onCreate?.(makingMine);
            }}
          />
        )}
      </>
    );
  }

  const filtered =
    filter === "All" ? packs : packs.filter((pack) => pack.facet === filter);

  const tabs = (["All", ...PACK_FACETS] as const).map((value) => ({
    value,
    label: value,
  }));

  return (
    <div className="@container">
      <PageHeader
        title="Packs"
        description="Ready-made agent setups. Start from one, or apply it to an agent you already have."
      />

      {loading ? (
        <ListSkeleton
          rowHeight={208}
          rows={6}
          className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3"
        />
      ) : packs.length === 0 ? (
        <PageEmptyState
          title="No packs yet"
          message="Packs bundle the skills, schedules and connections that make an agent useful. None are available on this platform yet."
          actionLabel="Create agent"
          onAction={() => onCreate?.(PACKS[0]!)}
        />
      ) : (
        <>
          <Tabs
            tabs={tabs}
            value={filter}
            onValueChange={setFilter}
            variant="pill"
            ariaLabel="Filter packs"
            className="mb-6"
          />
          {filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No {filter.toLowerCase()} packs yet.
            </p>
          ) : (
            <PackGrid packs={filtered} onSelect={setSelected} />
          )}
        </>
      )}

      <PackDetailSheet
        pack={selected}
        applyToName={applyTo?.name}
        connectedTemplateIds={connectedTemplateIds}
        onClose={() => setSelected(null)}
        onCreate={(pack) => {
          setSelected(null);
          if (applyTo) setApplying(pack);
          else onCreate?.(pack);
        }}
        onTry={(pack) => {
          setSelected(null);
          setDemo(pack);
        }}
      />

      {applying && applyTo && (
        <ApplyPackModal
          pack={applying}
          agentName={applyTo.name}
          preview={previewApply(applying, connectedTemplateIds)}
          onClose={() => setApplying(null)}
        />
      )}
    </div>
  );
}
