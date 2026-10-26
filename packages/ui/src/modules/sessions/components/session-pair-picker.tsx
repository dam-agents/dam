import {
  Add,
  ChevronLeft,
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
import { useProfiles } from "../../profiles/api/queries.js";
import { ModelConfiguration } from "../../profiles/components/profile-list.js";
import { useSaveAsProfile } from "../../profiles/components/save-as-profile.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
} from "../api/session-pair.js";
import { useConnectOnPick } from "../hooks/use-connect-on-pick.js";
import { useNextSessionPair } from "../hooks/use-next-session-pair.js";
import { useProviderUsage } from "../hooks/use-provider-usage.js";
import {
  attachableProviders,
  findModel,
  modelGroups,
  sameModel,
  sameSideGroups,
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
  pairSummary,
  settingDefaults,
  settingsForModel,
} from "../lib/session-settings.js";
import {
  pickProfile,
  primaryProfileOf,
  subagentOf,
  subagentProfileOf,
  withSubagent,
} from "../lib/subagent-choice.js";
import { useAttachProvidersDialog } from "./attach-providers-dialog.js";
import { DetachProviderMessage } from "./detach-provider-message.js";
import { PlatformSubagentSettings } from "./platform-subagent-settings.js";
import { SessionModelList } from "./session-model-list.js";
import { PairSummary, SessionPairTrigger } from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";
import { ToolApprovalPicker } from "./tool-approval-picker.js";

interface CommonProps {
  agentId: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConnectProviders: () => void;
  newLayout?: boolean;
}

type Props = CommonProps &
  (
    | { pending: true; agentHarness: string | undefined }
    | {
        pending?: false;
        carried: readonly HarnessCapability[];
        defaultHarness: string;
        routed?: boolean;
        /** UNIT_BOUNDARY_DESCRIPTION: edits a pick held elsewhere (a profile in Settings, with no agent): the Custom screen alone, every provider the owner holds, and a pick goes to `onChoose`, never to an agent's next session or chat default. `providerName` names a provider the owner does not hold. */
        edit?: {
          pair: SessionPair;
          providerName: string;
          onChoose: (pair: SessionPair) => void;
        };
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
  const {
    agentId,
    open,
    onOpenChange,
    onConnectProviders,
    newLayout = false,
  } = props;
  const carried = props.pending ? [] : props.carried;
  const routed = props.pending ? false : (props.routed ?? false);
  const edit = props.pending ? undefined : props.edit;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const picked = useStore((s) =>
    agentId ? (s.nextSessionPair[agentId] ?? null) : null,
  );
  const chosen = edit ? null : picked;
  const firstView = edit ? "custom" : "profiles";
  const [view, setView] = useState<"profiles" | "custom" | "subagent">(
    firstView,
  );
  const [fromProfile, setFromProfile] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { data: profiles = [] } = useProfiles(agentId);
  const manageProviders = newLayout;
  const setPair = useStore((s) => s.setNextSessionPair);

  const connections = useProviderConnections(agentId);
  const providers =
    agentId === null
      ? { ...connections, granted: connections.owned }
      : connections;
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
    edit?.pair ??
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
  /* UNIT_BOUNDARY_DESCRIPTION: the last pick in any chat is what the next chat
   * starts on (D90), so a pick saves the chat default too; a profile stays a
   * reference, and a subagent choice never detaches the primary from its (QA D2). */
  const choose = (
    chosenPair: SessionPair,
    references?: {
      profileId?: string | null;
      platformSubagentProfileId?: string | null;
    },
  ) => {
    if (edit) return edit.onChoose(chosenPair);
    if (!agentId) return;
    setPair(agentId, chosenPair);
    if (routed)
      rememberSessionPair(agentId, chosenPair, "chat", undefined, references);
  };
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;
  const catalogModels = useHarnessCatalogModels(
    agentId,
    routed ? harness : null,
    { unattached: true },
  );
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  const connectOnPick = useConnectOnPick(agentId);
  const models = groups.flatMap((g) => g.models.map((m) => ({ name: m.name })));
  const primary = primaryProfileOf(pair, profiles, capability);
  const slot = subagentProfileOf(pair, profiles);
  const customSlot = subagentOf(pair);
  const chooseSubagent = (
    next: SessionPair,
    platformSubagentProfileId: string | null,
  ) =>
    choose(next, {
      profileId: primary?.id ?? null,
      platformSubagentProfileId,
    });
  const saveAs = useSaveAsProfile({
    agentId: agentId ?? null,
    pair,
    providerTemplate: providers.owned.find((p) => p.id === pair?.provider)
      ?.templateId,
    from: fromProfile,
    capability,
    onSaved: (profile) => {
      setFromProfile(profile);
      if (pair) choose(pair, { profileId: profile.id });
    },
  });
  const confirmDisconnect = (name: string, id: string) => {
    const provider = providers.granted.find((p) => p.id === id);
    return void showConfirm(
      <DetachProviderMessage
        name={name}
        usage={
          provider
            ? usage(provider)
            : { kinds: [], schedules: [], profiles: [] }
        }
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
      ? pairSummary(pair.model, {
          settings,
          defaults,
          capability,
          provider:
            findModel(groups, pair.model)?.group.displayName ??
            provider?.name ??
            edit?.providerName,
        })
      : modelProviderLabel(
          pair.model,
          provider?.name,
          harnessName(pair.harness) ?? pair.harness,
        );

  const showProfiles =
    routed && !edit && view === "profiles" && profiles.length > 0;

  return (
    <div className="flex min-w-0 items-center gap-3">
      {attachDialog.dialog}
      {saveAs.dialog}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setView(firstView);
          onOpenChange?.(next);
        }}
      >
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
          {showProfiles ? (
            <div className="p-1">
              <ModelConfiguration
                agentId={agentId ?? null}
                profiles={profiles}
                customHint={`${harnesses.length} harness${harnesses.length === 1 ? "" : "es"}`}
                primary={{
                  selectedId: primary?.id ?? null,
                  custom:
                    primary || !pair ? null : (
                      <PairSummary harness={pair.harness} label={label ?? ""} />
                    ),
                  onPick: (profile) => {
                    setFromProfile(profile);
                    choose(
                      {
                        ...pickProfile(
                          pair,
                          profile,
                          carried.find((h) => h.name === profile.harness),
                          profile.harness === pair?.harness ? models : [],
                        ),
                        provider:
                          providers.granted.find(
                            (p) => p.templateId === profile.providerTemplate,
                          )?.id ?? null,
                      },
                      { profileId: profile.id },
                    );
                  },
                  onCustom: () => setView("custom"),
                }}
                subagent={{
                  selectedId: slot?.id ?? null,
                  custom:
                    slot || !customSlot ? null : (
                      <PairSummary
                        harness={customSlot.harness}
                        label={pairSummary(customSlot.model, {})}
                      />
                    ),
                  onPick: (profile) =>
                    pair &&
                    chooseSubagent(
                      withSubagent(pair, profile, capability, models),
                      profile.id,
                    ),
                  onCustom: () => setView("subagent"),
                }}
                onAgentPicks={() =>
                  pair &&
                  chooseSubagent(
                    withSubagent(pair, null, capability, models),
                    null,
                  )
                }
              />
            </div>
          ) : (
            <>
              {routed && !edit && (
                <button
                  type="button"
                  onClick={() => setView("profiles")}
                  className="flex items-center gap-1 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft size={14} aria-hidden />
                  Use a profile
                </button>
              )}
              {view === "subagent" && pair ? (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 p-2 text-xs">
                  <PlatformSubagentSettings
                    agentId={agentId}
                    carried={carried}
                    settings={pair.settings ?? {}}
                    idPrefix="new-session"
                    disabled={false}
                    onChange={(changes) => {
                      const next = {
                        ...pair,
                        settings: applySettingChanges(
                          pair.settings ?? {},
                          changes,
                        ),
                      };
                      chooseSubagent(
                        withSubagent(
                          next,
                          subagentOf(next),
                          capability,
                          models,
                        ),
                        null,
                      );
                    }}
                  />
                </div>
              ) : (
                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
                  {harnesses.length > 0 && (
                    <ul
                      role="group"
                      aria-label="Harness"
                      className="flex flex-col"
                    >
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
                              agentId={agentId}
                              harness={routed ? h.name : null}
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
                        groups={groups}
                        current={pair?.model ?? null}
                        loading={catalogModels.isLoading}
                        failed={catalogModels.isError}
                        onRetry={() => void catalogModels.refetch()}
                        onChoose={(model, group) =>
                          connectOnPick(group, model, () => {
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
                              ...(Object.keys(kept).length > 0 && {
                                settings: kept,
                              }),
                            });
                          })
                        }
                        onManageProviders={() =>
                          agentId
                            ? navigateToSandboxHome(agentId, "models")
                            : onConnectProviders()
                        }
                      />
                    </>
                  ) : agentId ? (
                    <OldRuntimeProviderSections
                      agentId={agentId}
                      harness={harness}
                      carried={carried}
                      sections={
                        manageProviders
                          ? sections.filter((p) => attached(p.id))
                          : sections
                      }
                      attached={attached}
                      pair={pair}
                      pending={pending}
                      harnessName={harnessName(harness)}
                      {...(!manageProviders && {
                        onDisconnect: confirmDisconnect,
                      })}
                      onAttach={attach}
                      onChoose={(id, model) =>
                        choose(withSettings({ harness, provider: id, model }))
                      }
                    />
                  ) : null}
                </div>
              )}
            </>
          )}
          {pair && !showProfiles && view !== "subagent" && (
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
          {routed &&
            !edit &&
            !showProfiles &&
            view !== "subagent" &&
            saveAs.row && (
              <div className="border-t border-border px-2 pt-2">
                {saveAs.row}
              </div>
            )}
          {!routed && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground">
              <PopoverClose asChild>
                <button
                  type="button"
                  onClick={() =>
                    agentId
                      ? navigateToSandboxHome(agentId, "models")
                      : onConnectProviders()
                  }
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Configure providers and defaults
                </button>
              </PopoverClose>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {pair && !edit && (
        <ToolApprovalPicker
          capability={capability}
          settings={settings}
          onChange={(changes) => {
            if (!agentId) return;
            setPair(agentId, {
              ...pair,
              settings: applySettingChanges(settings, changes),
            });
          }}
        />
      )}
    </div>
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
  harness: string | null;
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
