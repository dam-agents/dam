import { Add as Plus } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

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

  // The chooser opens to pick a preset; once picked, that preset's card
  // shows in unconfigured mode at the top of the section so the user can
  // enter the key inline. After save, the secret appears in the list and
  // we auto-clear `picked`.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [picked, setPicked] = useState<ProviderPresetType | null>(null);

  useEffect(() => {
    if (picked && secretByType[picked]) setPicked(null);
  }, [picked, secretByType]);

  const PickedCard = picked ? PROVIDER_CARDS[picked] : null;

  return (
    <div className="w-full max-w-2xl">
      <header className="flex items-center gap-3 mb-4">
        <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">
          Providers
        </h1>
        {/* Header CTA only shows once at least one provider is configured —
            on the empty state, the EmptyState card carries the primary CTA
            so the page has a single focal action. */}
        {hasAny && (
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => setChooserOpen(true)}>
              <Plus />
              <span className="hidden sm:inline">Set up</span> Provider
            </Button>
          </div>
        )}
      </header>

      <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
        API keys for the AI harnesses that power your agents.
      </p>

      {/* In-flight setup — picked provider's card shows above everything
          else so the form is the most prominent thing on the page until
          the user saves or backs out. */}
      {PickedCard && (
        <section className="mb-8 anim-in">
          <PickedCard secret={undefined} />
        </section>
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

      {!isPending && !hasAny && !PickedCard && (
        <EmptyState
          palette="sunset"
          className="mb-8"
          eyebrow="Providers"
          title="Connect your AI provider"
          description={
            <>
              DAM agents need an API key from a provider — Anthropic, IBM
              watsonx, OpenAI — to reach a model. Keys stay encrypted in the
              cluster and are injected at request time, so the agent never
              sees the raw value.
            </>
          }
          bullets={[
            {
              icon: <span className="text-[10px] font-bold">1</span>,
              text: (
                <>
                  Pick a provider — start with Anthropic for Claude Code
                  agents.
                </>
              ),
            },
            {
              icon: <span className="text-[10px] font-bold">2</span>,
              text: (
                <>
                  Paste your API key. It's encrypted at rest and routed via
                  the credential gateway, never written to a pod env.
                </>
              ),
            },
            {
              icon: <span className="text-[10px] font-bold">3</span>,
              text: (
                <>
                  You can add more providers later — agents can mix-and-match
                  per task.
                </>
              ),
            },
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
