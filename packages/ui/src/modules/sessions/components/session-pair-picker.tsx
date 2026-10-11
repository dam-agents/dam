import { Add, Unlink } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";

import { HarnessIcons } from "@/components/harness-icons";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
  type ProviderConnectionRef,
  providerOptions,
} from "../lib/session-pair-options.js";
import {
  SessionSettingsControls,
  settingDefaults,
} from "./session-settings-controls.js";

interface Props {
  agentId: string;
  carried: readonly HarnessCapability[];
  defaultHarness: string;
}

export function SessionPairPicker({ agentId, carried, defaultHarness }: Props) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const chosen = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const setPair = useStore((s) => s.setNextSessionPair);
  const providers = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);

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
  const sections = providers.owned.filter((p) =>
    [...offered.granted, ...offered.addable].some((o) => o.id === p.id),
  );
  const attached = (id: string) => offered.granted.some((p) => p.id === id);
  const provider = providers.granted.find((p) => p.id === pair?.provider);
  const harnessName = (name: string | undefined) =>
    harnesses.find((h) => h.name === name)?.displayName ?? name;
  const capability = carried.find((h) => h.name === harness);
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
  );
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const choose = (next: SessionPair) => setPair(agentId, next);
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="session-pair-picker"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {pair
            ? [pair.model, harnessName(pair.harness), provider?.name]
                .filter(Boolean)
                .join(" · ")
            : "Choose a harness and model"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="New session harness and model"
        className="flex w-[340px] flex-col gap-2 p-1 text-sm"
      >
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
          {harnesses.length > 0 && (
            <ul role="group" aria-label="Harness" className="flex flex-col">
              {harnesses.map((h) => (
                <li key={h.name}>
                  <button
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
                  >
                    <span className="text-muted-foreground">
                      <HarnessIcons harnesses={[h.name]} size="xs" />
                    </span>
                    {h.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <hr className="border-border" />
          {sections.map((p) =>
            attached(p.id) ? (
              <ProviderModels
                key={p.id}
                agentId={agentId}
                harness={harness}
                provider={p}
                current={pair?.provider === p.id ? pair.model : undefined}
                fallback={catalogModels(carried, harness)}
                disconnecting={pending}
                onDisconnect={() =>
                  void showConfirm(
                    <p>
                      Sessions running on <strong>{p.name}</strong> stop until
                      it is attached again. Schedules and channels that use it
                      move to another provider.
                    </p>,
                    `Disconnect ${p.name} from this agent?`,
                    { confirmLabel: "Disconnect" },
                  ).then((ok) => ok && revoke(p.id))
                }
                onChoose={(model) =>
                  choose(withSettings({ harness, provider: p.id, model }))
                }
              />
            ) : (
              <section
                key={p.id}
                aria-label={p.name}
                className="flex flex-col px-1"
              >
                <ProviderHeading name={p.name} />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void grant(p.id).then(
                      (ok) =>
                        ok &&
                        choose(
                          withSettings({
                            harness,
                            provider: p.id,
                            model: null,
                          }),
                        ),
                    )
                  }
                  className="inline-flex items-center gap-1.5 self-start py-1 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  <Add size={16} /> Attach this provider
                </button>
              </section>
            ),
          )}
          {sections.length === 0 && (
            <p className="px-1 text-muted-foreground">
              No connected model provider runs {harnessName(harness)}. Connect
              one first.
            </p>
          )}
        </div>
        {pair && (
          <div className="border-t border-border px-2 pt-2 empty:hidden">
            <SessionSettingsControls
              capability={capability}
              model={pair.model}
              settings={settings}
              defaults={defaults}
              onChange={(id, value) =>
                choose({ ...pair, settings: { ...settings, [id]: value } })
              }
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground">
          <PopoverClose asChild>
            <button
              type="button"
              onClick={() => navigateToSettings("providers")}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <Add size={14} /> Connect providers
            </button>
          </PopoverClose>
          {pair && (
            <SetAsDefault
              agentId={agentId}
              pair={{ ...pair, settings: { ...defaults, ...settings } }}
              remembered={remembered}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SetAsDefault({
  agentId,
  pair,
  remembered,
}: {
  agentId: string;
  pair: SessionPair;
  remembered: SessionPair | null | undefined;
}) {
  const saved =
    !!remembered &&
    remembered.harness === pair.harness &&
    remembered.provider === pair.provider &&
    remembered.model === pair.model &&
    Object.entries(pair.settings ?? {}).every(
      ([id, value]) => (remembered.settings?.[id] ?? value) === value,
    );
  return (
    <button
      type="button"
      disabled={saved}
      onClick={() => rememberSessionPair(agentId, pair)}
      className="shrink-0 whitespace-nowrap underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-60"
    >
      {saved ? "Default" : "Set as default"}
    </button>
  );
}

function ProviderHeading({
  name,
  onDisconnect,
  disabled,
}: {
  name: string;
  onDisconnect?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="group/provider flex h-6 items-center justify-between gap-2">
      <h3 className="truncate text-xs font-medium uppercase text-muted-foreground">
        {name}
      </h3>
      {onDisconnect && (
        <Tooltip content="Disconnect">
          <PopoverClose asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Disconnect ${name}`}
              onClick={onDisconnect}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/provider:opacity-100 disabled:opacity-50"
            >
              <Unlink size={14} />
            </button>
          </PopoverClose>
        </Tooltip>
      )}
    </div>
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
  disconnecting,
  onDisconnect,
  onChoose,
}: {
  agentId: string;
  harness: string;
  provider: ProviderConnectionRef;
  current: string | null | undefined;
  fallback: readonly { value: string; name: string }[];
  disconnecting: boolean;
  onDisconnect: () => void;
  onChoose: (model: string) => void;
}) {
  const { data, isLoading, isError, operable, refetch } = useProviderModels(
    agentId,
    harness,
    provider.id,
  );
  const models =
    data?.availableModels === null ? fallback : (data?.availableModels ?? []);
  const unavailable = isError || data?.availableModels === undefined;
  return (
    <section aria-label={provider.name} className="flex flex-col px-1">
      <ProviderHeading
        name={provider.name}
        onDisconnect={onDisconnect}
        disabled={disconnecting}
      />
      <ul className="flex flex-col">
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
                : unavailable
                  ? "Could not list this provider's models."
                  : "No models available."}
            {operable && !isLoading && unavailable && (
              <button
                type="button"
                className="ml-1 text-accent hover:underline"
                onClick={() => void refetch()}
              >
                Retry
              </button>
            )}
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
          "w-full truncate rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground",
          current && "font-medium text-foreground",
        )}
      >
        {label}
      </button>
    </PopoverClose>
  );
}
