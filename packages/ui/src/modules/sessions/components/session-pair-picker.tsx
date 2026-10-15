import {
  Add,
  Information,
  Unlink,
  WarningAltFilled,
} from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import { useState } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
import { labelVariants } from "@/components/ui/label";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useIsAgentAnswerableSoon } from "../../agents/api/queries.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import {
  addableProviders,
  modelGroups,
  modelIndicatorLabel,
  sameModel,
  sameSideGroups,
} from "../lib/catalog-groups.js";
import {
  fittingProviders,
  harnessDisplayName,
  harnessOptions,
  nextPair,
  type ProviderConnectionRef,
  providerOptions,
} from "../lib/session-pair-options.js";
import { SessionModelList } from "./session-model-list.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import {
  SessionSettingsControls,
  settingDefaults,
  settingsForModel,
} from "./session-settings-controls.js";

interface Props {
  agentId: string;
  carried: readonly HarnessCapability[];
  defaultHarness: string;
  routed?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConnectProviders: () => void;
}

export function SessionPairPicker({
  agentId,
  carried,
  defaultHarness,
  routed = false,
  open,
  onOpenChange,
  onConnectProviders,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const chosen = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const setPair = useStore((s) => s.setNextSessionPair);
  const providers = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);

  const views = catalog?.harnesses ?? [];
  const harnessName = (name: string) => harnessDisplayName(name, views);
  const names = carried.map((h) => h.name);
  const harnesses = harnessOptions(names, views);
  const pair = nextPair(
    chosen,
    remembered ?? null,
    names,
    fittingProviders(views, providers.granted),
    defaultHarness,
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
  const unsupported = (name: string) => {
    const fit = providerOptions(
      name,
      views,
      providers.granted,
      providers.owned,
    );
    return fit.granted.length === 0 && fit.addable.length === 0;
  };
  const capability = carried.find((h) => h.name === harness);
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
  );
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const choose = (next: SessionPair) => setPair(agentId, next);
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;
  const catalogModels = useHarnessCatalogModels(
    routed ? agentId : null,
    harness,
  );
  const answerableSoon = useIsAgentAnswerableSoon(routed ? agentId : null);
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  const addable = routed
    ? addableProviders(providers.granted, providers.owned, (c) =>
        offered.addable.some((p) => p.id === c.id),
      )
    : [];
  const confirmDisconnect = (name: string, id: string) =>
    void showConfirm(
      <p>
        Sessions running on <strong>{name}</strong> stop until it is attached
        again. Schedules and channels that use it move to another provider.
      </p>,
      `Disconnect ${name} from this agent?`,
      { kind: "destructive", confirmLabel: "Disconnect" },
    ).then((ok) => ok && revoke(id));

  if (providers.loaded && providers.owned.length === 0)
    return <ConnectProvidersPrompt onClick={onConnectProviders} />;

  const provider = providers.granted.find((p) => p.id === pair?.provider);
  const label = pair
    ? routed
      ? [modelIndicatorLabel(groups, pair.model), harnessName(pair.harness)]
      : [pair.model, harnessName(pair.harness), provider?.name]
    : [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <SessionPairTrigger
          label={
            catalog &&
            (pair
              ? label.filter(Boolean).join(" · ")
              : "Choose a harness and model")
          }
        />
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
                <li key={h.name} className="flex items-center">
                  <button
                    type="button"
                    disabled={unsupported(h.name)}
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
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
                  >
                    <span className="text-muted-foreground">
                      <HarnessIcons harnesses={[h.name]} size="xs" />
                    </span>
                    {h.displayName}
                  </button>
                  {unsupported(h.name) && (
                    <Tooltip
                      content={`${h.displayName} does not support any of the LLM providers you have configured.`}
                    >
                      <span
                        tabIndex={0}
                        aria-label={`Why ${h.displayName} is unavailable`}
                        className="px-2 text-muted-foreground"
                      >
                        <Information size={14} />
                      </span>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
          )}
          <hr className="border-border" />
          {routed ? (
            <>
              <SessionModelList
                groups={groups}
                harnessName={harnessName(harness)}
                current={pair?.model ?? null}
                loading={catalogModels.isLoading}
                waiting={catalogModels.waiting}
                failed={catalogModels.isError}
                operable={catalogModels.operable}
                starting={answerableSoon}
                onRetry={() => void catalogModels.refetch()}
                onChoose={(model, group) => {
                  const kept = settingsForModel(
                    capability,
                    groups,
                    model,
                    settings,
                  );
                  choose({
                    harness,
                    provider: group.connectionId,
                    model,
                    ...(Object.keys(kept).length > 0 && { settings: kept }),
                  });
                }}
                onDisconnect={(group) =>
                  confirmDisconnect(group.displayName, group.connectionId)
                }
                disconnecting={pending}
              />
              {addable.map(({ connection, conflict }) => (
                <section
                  key={connection.id}
                  aria-label={connection.name}
                  className="flex flex-col px-1"
                >
                  <ProviderHeading name={connection.name} />
                  <span className="inline-flex items-center gap-1 self-start">
                    <button
                      type="button"
                      disabled={pending || conflict !== null}
                      onClick={() =>
                        void grant(connection.id).then(
                          (ok) =>
                            ok &&
                            choose(
                              withSettings({
                                harness,
                                provider: connection.id,
                                model: null,
                              }),
                            ),
                        )
                      }
                      className="inline-flex items-center gap-1.5 py-1 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50 disabled:hover:no-underline"
                    >
                      <Add size={16} /> Attach this provider
                    </button>
                    {conflict && (
                      <Tooltip
                        content={`An agent holds one ${conflict.displayName} connection at a time; this agent already uses ${conflict.held.name}.`}
                      >
                        <span
                          tabIndex={0}
                          aria-label={`Why ${connection.name} cannot be attached`}
                          className="px-1 text-muted-foreground"
                        >
                          <Information size={14} />
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </section>
              ))}
              {groups.length === 0 &&
                addable.length === 0 &&
                !catalogModels.isLoading &&
                !catalogModels.isError &&
                catalogModels.operable && (
                  <p className="px-1 text-muted-foreground">
                    No connected model provider runs {harnessName(harness)}.
                    Connect one first.
                  </p>
                )}
            </>
          ) : (
            <OldRuntimeProviderSections
              agentId={agentId}
              harness={harness}
              carried={carried}
              sections={sections}
              attached={attached}
              pair={pair}
              pending={pending}
              harnessName={harnessName(harness)}
              onDisconnect={confirmDisconnect}
              onAttach={(id) =>
                void grant(id).then(
                  (ok) =>
                    ok &&
                    choose(
                      withSettings({ harness, provider: id, model: null }),
                    ),
                )
              }
              onChoose={(id, model) =>
                choose(withSettings({ harness, provider: id, model }))
              }
            />
          )}
        </div>
        {pair && (
          <div className="border-t border-border px-2 pt-2 empty:hidden">
            <SessionSettingsControls
              capability={capability}
              model={pair.model}
              settings={settings}
              defaults={defaults}
              modelChoices={sameSideGroups(groups, pair.model).flatMap((g) =>
                g.models.map((m) => ({
                  value: m.name,
                  name: `${m.upstreamId} · ${g.displayName}`,
                })),
              )}
              onChange={(id, value) => {
                const rest = Object.fromEntries(
                  Object.entries(settings).filter(([key]) => key !== id),
                );
                choose({
                  ...pair,
                  settings: value === "" ? rest : { ...rest, [id]: value },
                });
              }}
            />
          </div>
        )}
        <div className="border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground">
          <PopoverClose asChild>
            <button
              type="button"
              onClick={() => navigateToSandboxHome(agentId, "providers")}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Configure providers and defaults
            </button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ConnectProvidersPrompt({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <WarningAltFilled size={14} className="shrink-0 text-warning" />
      <span>
        <span className="underline underline-offset-2">
          Connect an LLM provider
        </span>{" "}
        first.
      </span>
    </button>
  );
}

export function SetAsDefault({
  agentId,
  pair,
  defaults,
  remembered,
}: {
  agentId: string;
  pair: SessionPair;
  defaults: Readonly<Record<string, string>>;
  remembered: SessionPair | null | undefined;
}) {
  const saved =
    !!remembered &&
    remembered.harness === pair.harness &&
    (pair.provider === null || remembered.provider === pair.provider) &&
    (remembered.model === pair.model ||
      sameModel(remembered.model, pair.model)) &&
    Object.entries(pair.settings ?? {}).every(
      ([id, value]) => (remembered.settings?.[id] ?? defaults[id]) === value,
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
      <h3 className={cn("truncate", labelVariants())}>{name}</h3>
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when
 * agents.runtimeFleet.outdated is empty on prod. Each attached provider's
 * models under its own heading, asked per provider.
 */
function OldRuntimeProviderSections({
  agentId,
  harness,
  carried,
  sections,
  attached,
  pair,
  pending,
  harnessName,
  onDisconnect,
  onAttach,
  onChoose,
}: {
  agentId: string;
  harness: string;
  carried: readonly HarnessCapability[];
  sections: readonly ProviderConnectionRef[];
  attached: (id: string) => boolean;
  pair: SessionPair | null;
  pending: boolean;
  harnessName: string | undefined;
  onDisconnect: (name: string, id: string) => void;
  onAttach: (id: string) => void;
  onChoose: (id: string, model: string) => void;
}) {
  return (
    <>
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
            onDisconnect={() => onDisconnect(p.name, p.id)}
            onChoose={(model) => onChoose(p.id, model)}
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
              onClick={() => onAttach(p.id)}
              className="inline-flex items-center gap-1.5 self-start py-1 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            >
              <Add size={16} /> Attach this provider
            </button>
          </section>
        ),
      )}
      {sections.length === 0 && (
        <p className="px-1 text-muted-foreground">
          No connected model provider runs {harnessName}. Connect one first.
        </p>
      )}
    </>
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
  const { data, isLoading, isError, operable, answerable, refetch } =
    useProviderModels(agentId, harness, provider.id);
  const [retrying, setRetrying] = useState(false);
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
            {!answerable ? (
              "Start the agent to list this provider's models."
            ) : !operable || isLoading || retrying ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size={12} className="text-muted-foreground" />
                Loading models…
              </span>
            ) : unavailable ? (
              "Couldn't load this provider's models."
            ) : (
              "No models available."
            )}
            {operable && !isLoading && !retrying && unavailable && (
              <Button
                variant="link"
                size="inline"
                className="ml-1"
                onClick={() => {
                  setRetrying(true);
                  void refetch().finally(() => setRetrying(false));
                }}
              >
                Retry
              </Button>
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
