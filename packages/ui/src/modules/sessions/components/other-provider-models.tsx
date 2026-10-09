import type { HarnessCapability, HarnessConfigChoice } from "agent-runtime-api";

import {
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
} from "../api/session-pair.js";
import {
  type ProviderConnectionRef,
  providerOptions,
} from "../lib/session-pair-options.js";

interface Props {
  agentId: string;
  harness: string;
  provider: string | null;
  carried: readonly HarnessCapability[];
}

export function OtherProviderModels({
  agentId,
  harness,
  provider,
  carried,
}: Props) {
  const { data: catalog } = useHarnessCatalog();
  const providers = useProviderConnections(agentId);
  const others = providerOptions(
    harness,
    catalog?.harnesses ?? [],
    providers.granted,
    [],
  ).granted.filter((p) => p.id !== provider);
  if (others.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="other-provider-models">
      <p className="text-xs text-muted-foreground">
        Models from other providers need a new session.
      </p>
      {others.map((p) => (
        <ProviderSection
          key={p.id}
          agentId={agentId}
          harness={harness}
          provider={p}
          fallback={
            carried
              .find((h) => h.name === harness)
              ?.harnessConfigCatalog?.options.find(
                (o) => o.category === "model",
              )?.choices ?? []
          }
        />
      ))}
    </div>
  );
}

function ProviderSection({
  agentId,
  harness,
  provider,
  fallback,
}: {
  agentId: string;
  harness: string;
  provider: ProviderConnectionRef;
  fallback: readonly HarnessConfigChoice[];
}) {
  const { data, isLoading, isError, operable } = useProviderModels(
    agentId,
    harness,
    provider.id,
  );
  const models =
    data?.availableModels === null ? fallback : (data?.availableModels ?? []);
  return (
    <section aria-label={provider.name}>
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        {provider.name}
      </h3>
      <ul className="-mx-1">
        {models.map((m) => (
          <li key={m.value}>
            <button
              type="button"
              disabled
              className="w-full truncate rounded px-1 py-1 text-left text-muted-foreground opacity-50"
            >
              {m.name}
            </button>
          </li>
        ))}
        {models.length === 0 && (
          <li className="px-1 py-1 text-muted-foreground opacity-50">
            {!operable
              ? "Start the agent to list this provider's models."
              : isLoading
                ? "Loading models…"
                : isError || data?.availableModels === undefined
                  ? "Could not list this provider's models."
                  : "No models available."}
          </li>
        )}
      </ul>
    </section>
  );
}
