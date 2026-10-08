import { Add, Close } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import { modelDisplayName } from "../lib/session-model.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
  type ProviderConnectionRef,
  providerOptions,
} from "../lib/session-pair-options.js";

interface Props {
  agentId: string;
  carried: readonly HarnessCapability[];
  defaultHarness: string;
}

export function SessionPairPicker({ agentId, carried, defaultHarness }: Props) {
  const titleId = useId();
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const chosen = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const setPair = useStore((s) => s.setNextSessionPair);
  const providers = useProviderConnections(agentId);
  const { grant, pending } = useGrantProvider(agentId);

  const views = catalog?.harnesses ?? [];
  const names = carried.map((h) => h.name);
  const harnesses = harnessOptions(names, views);
  const pair = nextPair(
    chosen,
    remembered ?? null,
    names,
    fittingProviders(views, providers.granted),
  );
  const harness =
    (chosen && names.includes(chosen.harness) ? chosen.harness : null) ??
    pair?.harness ??
    defaultHarness;
  const offered = providerOptions(
    harness,
    views,
    providers.granted,
    providers.owned,
  );
  const provider = providers.granted.find((p) => p.id === pair?.provider);
  const pairName =
    harnesses.find((h) => h.name === pair?.harness)?.displayName ??
    pair?.harness;
  const choose = (next: SessionPair) => setPair(agentId, next);
  const harnessName =
    harnesses.find((h) => h.name === harness)?.displayName ?? harness;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="session-pair-picker"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {pair
            ? `${pairName ?? ""} · ${pair.model ? modelDisplayName(pair.model) : "default model"}${provider ? ` · ${provider.name}` : ""}`
            : "Choose a harness and model"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={titleId}
        className="flex w-[340px] flex-col gap-3 text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-bold text-foreground">
            New session runs on
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
            >
              <Close size={16} />
            </Button>
          </PopoverClose>
        </div>
        {harnesses.length > 1 && (
          <div
            role="group"
            aria-label="Harness"
            className="flex flex-wrap gap-1"
          >
            {harnesses.map((h) => (
              <button
                key={h.name}
                type="button"
                aria-pressed={h.name === harness}
                onClick={() =>
                  choose({
                    harness: h.name,
                    provider:
                      providerOptions(
                        h.name,
                        views,
                        providers.granted,
                        providers.owned,
                      ).granted[0]?.id ?? null,
                    model: null,
                  })
                }
                className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground hover:text-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
              >
                {h.displayName}
              </button>
            ))}
          </div>
        )}
        <div className="-mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto">
          {offered.granted.map((p) => (
            <ProviderModels
              key={p.id}
              agentId={agentId}
              harness={harness}
              provider={p}
              current={pair?.provider === p.id ? pair.model : undefined}
              fallback={catalogModels(carried, harness)}
              onChoose={(model) => choose({ harness, provider: p.id, model })}
            />
          ))}
          {offered.granted.length === 0 && (
            <p className="px-1 text-muted-foreground">
              This agent holds no model provider {harnessName} can run on.
              {offered.addable.length === 0 &&
                " Connect one in Settings, then add it here."}
            </p>
          )}
          {offered.addable.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              aria-label={`Grant ${p.name} to this agent`}
              onClick={() =>
                void grant(p.id).then(
                  (ok) =>
                    ok && choose({ harness, provider: p.id, model: null }),
                )
              }
              className="inline-flex items-center gap-1.5 self-start px-1 font-medium text-accent hover:underline disabled:opacity-50"
            >
              <Add size={16} /> {p.name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function catalogModels(
  carried: readonly HarnessCapability[],
  harness: string,
): readonly { value: string; name: string }[] {
  return (
    carried
      .find((h) => h.name === harness)
      ?.harnessConfigCatalog?.options.find((o) => o.category === "model")
      ?.choices ?? []
  );
}

function ProviderModels({
  agentId,
  harness,
  provider,
  current,
  fallback,
  onChoose,
}: {
  agentId: string;
  harness: string;
  provider: ProviderConnectionRef;
  current: string | null | undefined;
  fallback: readonly { value: string; name: string }[];
  onChoose: (model: string | null) => void;
}) {
  const { data, isLoading, isError, operable } = useProviderModels(
    agentId,
    harness,
    provider.id,
  );
  const models = data?.availableModels ?? fallback;
  return (
    <section aria-label={provider.name} className="flex flex-col">
      <h3 className="px-1 text-xs font-medium uppercase text-muted-foreground">
        {provider.name}
      </h3>
      <ul className="flex flex-col">
        <li>
          <ModelChoice
            label="Default model"
            current={current === null}
            onClick={() => onChoose(null)}
          />
        </li>
        {models.map((m) => (
          <li key={m.value}>
            <ModelChoice
              label={m.name}
              current={current === m.value}
              onClick={() => onChoose(m.value)}
            />
          </li>
        ))}
        {models.length === 0 && (
          <li className="px-1 py-1 text-muted-foreground">
            {!operable
              ? "Start the agent to list this provider's models."
              : isLoading
                ? "Loading models…"
                : isError
                  ? "Could not list this provider's models."
                  : null}
          </li>
        )}
      </ul>
    </section>
  );
}

function ModelChoice({
  label,
  current,
  onClick,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <PopoverClose asChild>
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        onClick={onClick}
        className={cn(
          "w-full truncate rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground",
          current && "font-medium text-foreground",
        )}
      >
        {label}
      </button>
    </PopoverClose>
  );
}
