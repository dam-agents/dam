import { Add as Plus } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  PROVIDER_PRESET_TYPES,
  type ProviderPresetType,
  PROVIDERS,
} from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { PROVIDER_CARDS } from "../components/provider-cards.js";
import { ProviderChooserDialog } from "../components/provider-chooser-dialog.js";

export function ProvidersView() {
  const {
    data: secrets = [],
    isPending,
  } = useSecrets();

  // Index by SecretType so each Card receives its own (or undefined for the
  // wizard flow). One pass over the secrets list, then constant lookups.
  const secretByType = Object.fromEntries(
    secrets.map((s) => [s.type, s]),
  ) as Partial<Record<ProviderPresetType, (typeof secrets)[number]>>;

  const configured = PROVIDER_PRESET_TYPES.filter((t) => secretByType[t]);
  const hasAny = configured.length > 0;

  // Two stacked modals: the chooser (pick a preset) → the setup modal
  // (paste a key). Picking inside the chooser closes it and opens the
  // setup modal. Closing the setup modal without saving leaves the page
  // untouched — nothing reaches the providers list until a key is saved
  // and the api-server returns a real secret. After save, the secret
  // appears in the list and the auto-clear below dismisses the modal.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [picked, setPicked] = useState<ProviderPresetType | null>(null);

  useEffect(() => {
    if (picked && secretByType[picked]) setPicked(null);
  }, [picked, secretByType]);

  const PickedCard = picked ? PROVIDER_CARDS[picked] : null;

  return (
    <div className="w-full max-w-2xl">
      {/* Header + description only render once at least one provider
          is configured. On the empty state the EmptyState card's own
          title carries the page heading. */}
      {hasAny && (
        <>
          <header className="flex items-center gap-3 mb-4">
            <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">
              Providers
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={() => setChooserOpen(true)}>
                <Plus />
                <span className="hidden sm:inline">Set up</span> Provider
              </Button>
            </div>
          </header>

          <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
            API keys for the AI harnesses that power your agents.
          </p>
        </>
      )}

      {isPending && (
        <section className="mb-8">
          <SkeletonCard />
        </section>
      )}

      {!isPending && hasAny && (
        <section className="mb-8 flex flex-col gap-4">
          {configured.map((id) => {
            const Card = PROVIDER_CARDS[id];
            return <Card key={id} secret={secretByType[id]} />;
          })}
        </section>
      )}

      {!isPending && !hasAny && (
        <EmptyState
          palette="sunset"
          className="mb-8"
          title="Set up a provider"
          description={
            <>
              Agents need an API key from a provider — Anthropic, OpenAI,
              IBM LiteLLM, or Bob Shell — to reach a model. Keys are stored
              as K8s Secrets and injected by the credential gateway at
              request time, so the agent runtime never sees the raw value.
            </>
          }
          bullets={[
            <>
              <span className="font-semibold">Pick a preset</span> — start
              with Anthropic for Claude Code agents.
            </>,
            <>
              <span className="font-semibold">Paste your key</span> —
              encrypted at rest and routed via the per-instance Envoy
              gateway, never written to a pod env.
            </>,
            <>
              <span className="font-semibold">Add as many as you need</span>{" "}
              — each agent picks one provider, and different agents can use
              different ones.
            </>,
          ]}
          action={
            <Button onClick={() => setChooserOpen(true)}>
              <Plus /> Set up Provider
            </Button>
          }
        />
      )}

      <ProviderChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        configuredTypes={new Set(configured)}
        onPick={(type) => {
          setChooserOpen(false);
          setPicked(type);
        }}
      />

      {/* Setup modal — opens stacked on top of the chooser flow. The
          provider's card renders inside; closing without saving leaves
          the page untouched, and after save the auto-clear effect above
          dismisses the modal. */}
      {PickedCard && picked && (
        <Dialog open onOpenChange={(o) => !o && setPicked(null)}>
          <DialogContent className="max-w-lg">
            {/* The card supplies its own title + brand mark, so the
                DialogTitle is hidden but kept for screen readers. */}
            <DialogTitle className="sr-only">
              Set up {PROVIDERS[picked].displayName}
            </DialogTitle>
            <PickedCard secret={undefined} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
  );
}

// Re-exported for the chooser to query metadata without importing types
// directly.
export { PROVIDERS };
