import { RefreshCw } from "lucide-react";

import { PROVIDER_PRESET_TYPES, type ProviderPresetType } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { ComingSoonCard } from "../components/coming-soon-card.js";
import { PROVIDER_CARDS } from "../components/provider-cards.js";

export function ProvidersView() {
  const {
    data: secrets = [],
    refetch,
    isFetching,
    isPending,
  } = useSecrets();

  // Index by SecretType so each Card receives its own (or undefined for the
  // wizard flow). One pass over the secrets list, then constant lookups.
  const secretByType = Object.fromEntries(
    secrets.map((s) => [s.type, s]),
  ) as Partial<Record<ProviderPresetType, (typeof secrets)[number]>>;

  return (
    <div className="w-full max-w-2xl">
      <header className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">Providers</h1>
        <button
          onClick={() => refetch()}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal shadow-brutal-sm"
        >
          <span className={isFetching ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </header>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        API keys for the AI harnesses that power your agents.
      </p>

      <section className="mb-8 flex flex-col gap-4">
        {isPending
          ? <SkeletonCard />
          : PROVIDER_PRESET_TYPES.map((id) => {
              const Card = PROVIDER_CARDS[id];
              return <Card key={id} secret={secretByType[id]} />;
            })}
      </section>

      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ComingSoonCard name="Google" description="Powers Gemini CLI agents" />
        </div>
      </section>
    </div>
  );
}

function SkeletonCard() {
  return <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />;
}
