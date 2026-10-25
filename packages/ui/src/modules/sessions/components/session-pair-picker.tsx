import {
  Add,
  ChevronLeft,
  Information,
  Unlink,
  WarningAltFilled,
} from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage } from "api-server-api";
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
import { useAgent } from "../../agents/api/queries.js";
import { isOwnAgent } from "../../agents/lib/agent-editors.js";
import { useProfiles } from "../../profiles/api/queries.js";
import {
  ProfileList,
  SaveAsProfileRow,
  SubagentSection,
} from "../../profiles/components/profile-list.js";
import { SaveAsProfile } from "../../profiles/components/save-as-profile.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
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
import { subagentProfileOf, withSubagent } from "../lib/subagent-choice.js";
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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  /* UNIT_BOUNDARY_DESCRIPTION: an Agent Editor may use the owner's profiles and
   * not change that set, so the save is not offered on a shared agent. */
  const agent = useAgent(agentId);
  const canSaveProfile = agent === null || isOwnAgent(agent);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const picked = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const chosen = picked;
  /* UNIT_BOUNDARY_DESCRIPTION: the picker opens on the profiles; the full picker
   * is one row away, so a routine pick is a name rather than a catalog. */
  const [custom, setCustom] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  /* UNIT_BOUNDARY_DESCRIPTION: the profile the pick came from, kept while the
   * user tunes it in the full picker, so the save can offer to update it. */
  const [fromProfile, setFromProfile] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { data: profiles = [] } = useProfiles(agentId);
  const manageProviders = newLayout;
  const setPair = useStore((s) => s.setNextSessionPair);

  const providers = useProviderConnections(agentId);
  const usage = useProviderUsage(agentId);
  const { grant, revoke, pending: revoking } = useGrantProvider(agentId);
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
  /* UNIT_BOUNDARY_DESCRIPTION: a profile pick may move the primary harness, so
   * the subagent rule is resolved against the harness the pick lands on. */
  const capabilityOf = (name: string) => carried.find((h) => h.name === name);
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    pair?.harness === harness ? (pair.model ?? null) : null,
  );
  /* UNIT_BOUNDARY_DESCRIPTION: the last pick in any chat is what the next chat
   * starts on (D90), so a pick saves the chat default as well as choosing for
   * this session. It saves what the pick names: a profile stays a reference. */
  const choose = (
    chosenPair: SessionPair,
    references?: {
      profileId?: string | null;
      platformSubagentProfileId?: string | null;
    },
  ) => {
    setPair(agentId, chosenPair);
    if (routed)
      rememberSessionPair(agentId, chosenPair, "chat", undefined, references);
  };
  const chooseProfile = (
    profile: ProfileWithUsage,
    grantedConnectionId?: string,
  ) => {
    const connection =
      providers.granted.find(
        (p) => p.templateId === profile.providerTemplate,
      ) ?? providers.owned.find((p) => p.id === grantedConnectionId);
    setFromProfile({ id: profile.id, name: profile.name });
    /* UNIT_BOUNDARY_DESCRIPTION: the profile owns the session's own settings;
     * the platform sub-agent slot keeps its reference and its keys, so a pick
     * does not clear a choice the profile has no opinion about. */
    const kept = Object.fromEntries(
      Object.entries(pair?.settings ?? {}).filter(([id]) =>
        id.startsWith("platformSubagent."),
      ),
    );
    /* UNIT_BOUNDARY_DESCRIPTION: the subagent choice survives a primary pick,
     * re-applied through the rule so its native and slot keys stay in step. */
    const slot = subagentProfileOf(pair, profiles);
    const next = {
      ...kept,
      ...profile.settings,
      ...(slot === null
        ? {}
        : (withSubagent(
            { harness: profile.harness, provider: null, model: profile.model },
            slot,
            capabilityOf(profile.harness),
            [],
          ).settings ?? {})),
    };
    choose(
      {
        harness: profile.harness,
        provider: connection?.id ?? null,
        model: profile.model,
        ...(Object.keys(next).length > 0 && { settings: next }),
      },
      { profileId: profile.id },
    );
  };
  /* UNIT_BOUNDARY_DESCRIPTION: what the view shows about the subagent slot and
   * about what "Custom selection" costs, both read rather than kept in state. */
  const subagentProfileId = subagentProfileOf(pair, profiles)?.id ?? null;
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;
  const catalogModels = useHarnessCatalogModels(
    routed ? agentId : null,
    harness,
  );
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  /* UNIT_BOUNDARY_DESCRIPTION: the counts a person judges "Custom selection" by — the harnesses and models this agent can run. */
  const catalogCounts = {
    harnesses: harnesses.length,
    models: groups.reduce((total, group) => total + group.models.length, 0),
  };
  /* UNIT_BOUNDARY_DESCRIPTION: an unavailable profile is repaired before it is
   * picked: the owner's Connection of its provider is attached to this agent,
   * whose grant refuses a rival alias, and then the pick is made. */
  const attachAndPick = (profile: ProfileWithUsage, forSubagent = false) => {
    const connection = providers.owned.find(
      (p) => p.templateId === profile.providerTemplate,
    );
    if (!connection) {
      navigateToSettings("providers");
      return;
    }
    void grant(connection.id).then((ok) => {
      if (!ok) return;
      /* UNIT_BOUNDARY_DESCRIPTION: the grant is read back from its own answer,
       * not from the connections list this render captured, and the rule is
       * resolved without a model list, since the listing the grant starts has
       * not arrived yet — another harness then falls back to the agent's pick
       * for the native subagent, which is the rule's safe side. */
      if (forSubagent) {
        if (pair)
          choose(
            withSubagent(pair, profile, capabilityOf(profile.harness), []),
            { platformSubagentProfileId: profile.id },
          );
        return;
      }
      chooseProfile(profile, connection.id);
    });
  };
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

  const profileConnection = providers.owned.find(
    (p) => p.id === pair?.provider,
  );
  const savingAsProfile =
    savingProfile && pair && profileConnection?.templateId !== undefined ? (
      <SaveAsProfile
        agentId={agentId}
        pair={pair}
        providerTemplate={profileConnection.templateId}
        profile={fromProfile}
        onClose={() => setSavingProfile(false)}
        onSaved={(profileId, name) => {
          setSavingProfile(false);
          setFromProfile({ id: profileId, name });
          choose(pair, { profileId });
        }}
      />
    ) : null;

  return (
    <>
      {attachDialog.dialog}
      {savingAsProfile}
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
          {routed && !custom && profiles.length > 0 ? (
            <div className="flex flex-col gap-1 p-1">
              <ProfileList
                profiles={profiles}
                current={pair}
                counts={catalogCounts}
                onPick={chooseProfile}
                onCustom={() => setCustom(true)}
                onAttach={attachAndPick}
                onManage={() => navigateToSettings("providers")}
              />
              <SubagentSection
                profiles={profiles}
                selectedId={subagentProfileId}
                onAgentPicks={() => {
                  if (pair)
                    choose(withSubagent(pair, null), {
                      platformSubagentProfileId: null,
                    });
                }}
                onPick={(profile) => {
                  if (!pair) return;
                  /* UNIT_BOUNDARY_DESCRIPTION: the rule's values come from the
                   * primary harness's capability and the models it lists, so a
                   * subagent pick writes the native model too. */
                  choose(
                    withSubagent(
                      pair,
                      profile,
                      capabilityOf(pair.harness),
                      groups.flatMap((g) =>
                        g.models.map((m) => ({ name: m.name })),
                      ),
                    ),
                    { platformSubagentProfileId: profile.id },
                  );
                }}
                onAttach={(profile) => attachAndPick(profile, true)}
                onManage={() => navigateToSettings("providers")}
              />
            </div>
          ) : (
            <>
              {routed && (
                <button
                  type="button"
                  onClick={() => setCustom(false)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft size={14} aria-hidden />
                  Use a profile
                </button>
              )}
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
                          ...(Object.keys(kept).length > 0 && {
                            settings: kept,
                          }),
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
                )}
              </div>
            </>
          )}
          {pair && !(routed && !custom && profiles.length > 0) && (
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
            (custom || profiles.length === 0) &&
            pair &&
            canSaveProfile && (
              <div className="border-t border-border px-2 pt-2">
                <SaveAsProfileRow
                  label={
                    fromProfile
                      ? `Update “${fromProfile.name}”`
                      : "Save as a profile"
                  }
                  onClick={() => setSavingProfile(true)}
                />
              </div>
            )}
          {!routed && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-2 pb-1 pt-2 text-xs text-muted-foreground">
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
          )}
        </PopoverContent>
      </Popover>
    </>
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
