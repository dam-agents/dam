import {
  Add,
  Information,
  Unlink,
  WarningAltFilled,
} from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { DefaultKind, SessionPair } from "api-server-api";
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
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  rememberFirstModel,
  rememberSessionPair,
  samePair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import { useNextSessionPair } from "../hooks/use-next-session-pair.js";
import { useProviderUsage } from "../hooks/use-provider-usage.js";
import {
  attachableProviders,
  modelGroups,
  sameModel,
  sameSideGroups,
  sessionModelLabel,
} from "../lib/catalog-groups.js";
import { DEFAULT_KIND_LABEL, DEFAULT_KIND_TITLE } from "../lib/default-kind.js";
import {
  harnessDisplayName,
  harnessOptions,
  modelProviderLabel,
  pairLabel,
  type ProviderConnectionRef,
  providerOptions,
} from "../lib/session-pair-options.js";
import {
  applySettingChanges,
  settingDefaults,
  settingsForModel,
} from "../lib/session-settings.js";
import { useAttachProvidersDialog } from "./attach-providers-dialog.js";
import { DetachProviderMessage } from "./detach-provider-message.js";
import { SessionModelList } from "./session-model-list.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

interface CommonProps {
  agentId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConnectProviders: () => void;
}

type Props = CommonProps &
  (
    | { pending: true; agentHarness: string | undefined }
    | {
        pending?: false;
        carried: readonly HarnessCapability[];
        defaultHarness: string;
        routed?: boolean;
      }
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness, model and session settings a new
 * session starts on, or, while the agent's harness list still loads, the pair
 * it expects with a loader in place of the body. Providers are not attached
 * or disconnected here: the model list ends with a Connect more providers
 * row that leads to the agent's Providers page.
 */
export function SessionPairPicker(props: Props) {
  const { agentId, open, onOpenChange, onConnectProviders } = props;
  const carried = props.pending ? [] : props.carried;
  const routed = props.pending ? false : (props.routed ?? false);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const picked = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const chosen = picked;
  const setPair = useStore((s) => s.setNextSessionPair);
  const clearPair = useStore((s) => s.clearNextSessionPair);
  const { data: remembered } = useRememberedPair(agentId);
  const { data: status } = useHarnessConfigStatus(agentId);
  const providers = useProviderConnections(agentId);
  const usage = useProviderUsage(agentId);
  const { revoke, pending: revoking } = useGrantProvider(agentId);
  const attachDialog = useAttachProvidersDialog(agentId);
  const pending = revoking || attachDialog.pending;
  const attach = (connection: { id: string }) =>
    void attachDialog
      .ask(harness, attachableProviders(providers.granted, offered.addable), [
        connection.id,
      ])
      .then((ids) => {
        const provider = ids?.includes(connection.id)
          ? connection.id
          : ids?.[0];
        if (provider) choose(withSettings({ harness, provider, model: null }));
      });

  const views = catalog?.harnesses ?? [];
  const harnessName = (name: string) => harnessDisplayName(name, views);
  const names = props.pending
    ? [props.agentHarness ?? catalog?.default].filter((h) => h !== undefined)
    : carried.map((h) => h.name);
  const harnesses = harnessOptions(names, views);
  const defaultHarness = props.pending
    ? (names[0] ?? "")
    : props.defaultHarness;
  const next = useNextSessionPair(agentId, names, defaultHarness);
  const pair =
    next ??
    (props.pending && names[0]
      ? { harness: names[0], provider: null, model: null }
      : null);
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
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    pair?.harness === harness ? (pair.model ?? null) : null,
  );
  const choose = (chosenPair: SessionPair) => {
    setPair(agentId, chosenPair);
    if (routed) void rememberFirstModel(agentId, chosenPair);
  };
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;
  const catalogModels = useHarnessCatalogModels(
    routed ? agentId : null,
    harness,
  );
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted).filter(
        (g) => !catalog || offered.granted.some((p) => p.id === g.connectionId),
      )
    : [];
  const confirmDisconnect = (name: string, id: string) => {
    const provider = providers.granted.find((p) => p.id === id);
    return void showConfirm(
      <DetachProviderMessage
        name={name}
        usage={provider ? usage(provider) : { kinds: [], schedules: [] }}
      />,
      `Disconnect ${name} from this agent?`,
      { kind: "destructive", confirmLabel: "Disconnect" },
    ).then((ok) => ok && revoke(id));
  };

  if (providers.loaded && providers.owned.length === 0)
    return <ConnectProvidersPrompt onClick={onConnectProviders} />;

  if (props.pending)
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <SessionPairTrigger
            harness={pair?.harness}
            label={
              pair
                ? pairLabel(pair, catalog?.harnesses, providers.granted)
                : undefined
            }
            aria-busy
          />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label="New session harness and model"
          className="w-[340px] p-3 text-sm"
        >
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-muted-foreground"
          >
            <Spinner size={12} className="text-muted-foreground" />
            Loading models…
          </span>
        </PopoverContent>
      </Popover>
    );

  const provider = providers.granted.find((p) => p.id === pair?.provider);
  const label = !pair
    ? undefined
    : routed
      ? (sessionModelLabel(groups, pair.model) ?? "Choose a model")
      : modelProviderLabel(
          pair.model,
          provider?.name,
          harnessName(pair.harness) ?? pair.harness,
        );

  return (
    <>
      {attachDialog.dialog}
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <SessionPairTrigger
            harness={pair?.harness}
            label={catalog && (pair ? label : "Choose a harness and model")}
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
                      <HarnessModelCount
                        agentId={routed ? agentId : null}
                        harness={h.name}
                      />
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
                  agentId={agentId}
                  groups={groups}
                  current={pair?.model ?? null}
                  loading={catalogModels.isLoading}
                  waiting={catalogModels.waiting}
                  failed={catalogModels.isError}
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
                  onManageProviders={() =>
                    navigateToSandboxHome(agentId, "providers")
                  }
                />
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
                onAttach={attach}
                onChoose={(id, model) =>
                  choose(withSettings({ harness, provider: id, model }))
                }
              />
            )}
          </div>
          {pair && (
            <div className="border-t border-border px-2 pt-2 empty:hidden">
              <SessionSettingsControls
                agentId={agentId}
                carried={carried}
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
                onChange={(changes) =>
                  choose({
                    ...pair,
                    settings: applySettingChanges(settings, changes),
                  })
                }
              />
            </div>
          )}
          {(!routed || (pair && routed && status?.followsDefaults)) && (
            // UNIT_BOUNDARY_DESCRIPTION: the popover's last row holds the two acts on the default and nothing else: back to the default, and set the pick as it. Left on the default, the row is blank.
            <div className="flex items-center justify-between gap-3 border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground empty:hidden">
              {pair &&
                routed &&
                status?.followsDefaults &&
                !onDefaultPair(pair, chosen, remembered) && (
                  <button
                    type="button"
                    onClick={() => clearPair(agentId)}
                    className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
                  >
                    Back to default
                  </button>
                )}
              {pair &&
                pair.model !== null &&
                !onDefaultPair(pair, chosen, remembered) && (
                  <button
                    type="button"
                    data-testid="session-pair-set-default"
                    onClick={() =>
                      rememberSessionPair(agentId, pair, "chat", () =>
                        clearPair(agentId),
                      )
                    }
                    className="shrink-0 whitespace-nowrap underline underline-offset-2 hover:text-foreground"
                  >
                    Set as default
                  </button>
                )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: whether the picker's pair is the chat default: nothing picked, or the pick the agent remembers. The row of acts on the default stays blank while it is.
export function onDefaultPair(
  pair: SessionPair,
  chosen: SessionPair | null,
  remembered: SessionPair | null | undefined,
): boolean {
  return chosen === null || (!!remembered && samePair(pair, remembered));
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
  kind,
  pair,
  defaults,
  remembered,
  onSet,
}: {
  agentId: string;
  kind: DefaultKind;
  pair: SessionPair;
  defaults: Readonly<Record<string, string>>;
  remembered: SessionPair | null | undefined;
  onSet?: () => void;
}) {
  if (pair.model === null) return null;
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
      onClick={() => {
        rememberSessionPair(agentId, pair, kind, onSet);
      }}
      className="shrink-0 whitespace-nowrap underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-60"
    >
      {saved
        ? `${DEFAULT_KIND_TITLE[kind]} default`
        : `Set as ${DEFAULT_KIND_LABEL[kind]} default`}
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
  onDisconnect?: (name: string, id: string) => void;
  onAttach: (provider: { id: string }) => void;
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
            {...(onDisconnect && {
              onDisconnect: () => onDisconnect(p.name, p.id),
            })}
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
              onClick={() => onAttach(p)}
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
  onDisconnect?: () => void;
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

function HarnessModelCount({
  agentId,
  harness,
}: {
  agentId: string | null;
  harness: string;
}) {
  const { data } = useHarnessCatalogModels(agentId, harness);
  if (!data) return null;
  const count = data.providers.reduce(
    (total, provider) => total + provider.models.length,
    0,
  );
  return (
    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
      {count} {count === 1 ? "model" : "models"}
    </span>
  );
}
