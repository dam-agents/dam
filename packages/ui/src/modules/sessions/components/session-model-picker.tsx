import {
  Checkmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Information,
} from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import { modelConstraintsFor } from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import { Fragment, type ReactNode, useId, useState } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { labelVariants } from "@/components/ui/label";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useProfileAttach } from "../../profiles/hooks/use-profile-attach.js";
import {
  profileDetailRows,
  sortProfiles,
} from "../../profiles/lib/profile-detail.js";
import {
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
} from "../api/session-pair.js";
import { useConnectOnPick } from "../hooks/use-connect-on-pick.js";
import { findModel, modelGroups, sameModel } from "../lib/catalog-groups.js";
import {
  familyModelGroups,
  type MenuEntry,
  type ModelOption,
  prettyModelLabel,
} from "../lib/model-families.js";
import {
  harnessDisplayName,
  providerOfModel,
  providerOptions,
} from "../lib/session-pair-options.js";
import {
  applySettingChanges,
  sessionSettingOptions,
  settingDefaults,
  settingsForModel,
} from "../lib/session-settings.js";
import { subagentOf, withSubagent } from "../lib/subagent-choice.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

const OLDER_VERSIONS = "__older_versions__";

interface Entry extends MenuEntry {
  family?: string;
}

/* UNIT_BOUNDARY_DESCRIPTION: which slot a pick touched: the primary model, harness or provider, the subagent's own values, or an explicit "Same as agent" that leaves the subagent to the harness. */
export type PickerIntent = "primary" | "subagent" | "subagent-clear";

/** UNIT_BOUNDARY_DESCRIPTION: the one body of the harness and model panel: Harness, Model, Provider and Effort as dropdowns, Subagents behind More options, "Use a profile" at the bottom and the saved profiles behind it. A pick goes back as a whole pair, so a chat's next session, an open session, a page's default and a profile in Settings share it. */
export function SessionModelPicker({
  agentId,
  carried,
  harnesses,
  pair,
  defaultHarness,
  locked,
  note,
  profiles = [],
  selectedProfileId = null,
  onPickProfile,
  onEditProfile,
  onManageProfiles,
  agentDefault,
  saveAsProfile,
  onLeaveProfiles,
  onChoose,
  onManageProviders,
}: {
  agentId: string | null;
  carried: readonly HarnessCapability[];
  harnesses: readonly string[];
  pair: SessionPair | null;
  defaultHarness: string;
  /** UNIT_BOUNDARY_DESCRIPTION: an open session keeps its harness, so it reads as text with a popover explaining why and linking to a new session. */
  locked?: { onNewSession: () => void };
  /** UNIT_BOUNDARY_DESCRIPTION: a picked model takes effect on the next message only. */
  note?: string;
  profiles?: readonly ProfileWithUsage[];
  selectedProfileId?: string | null;
  onPickProfile?: (profile: ProfileWithUsage, connectionId?: string) => void;
  onEditProfile?: (profile: ProfileWithUsage) => void;
  onManageProfiles?: () => void;
  /** UNIT_BOUNDARY_DESCRIPTION: a channel or a schedule follows the agent's default until it is switched off, which copies the default's values into its own pick. */
  agentDefault?: {
    active: boolean;
    pair: SessionPair | null;
    onActivate: () => void;
    onDeactivate: () => void;
  };
  saveAsProfile?: ReactNode;
  onLeaveProfiles?: () => void;
  onChoose: (pair: SessionPair, intent: PickerIntent) => void;
  onManageProviders: () => void;
}) {
  const uid = useId();
  const { data: catalog } = useHarnessCatalog();
  const views = catalog?.harnesses ?? [];
  const connections = useProviderConnections(agentId);
  const owned = connections.owned;
  const granted = agentId === null ? owned : connections.granted;
  const connectOnPick = useConnectOnPick(agentId);
  const { attach } = useProfileAttach(agentId);
  const [older, setOlder] = useState(false);
  const [view, setView] = useState<"custom" | "profiles">(() =>
    profiles.length > 0 && selectedProfileId ? "profiles" : "custom",
  );
  const [more, setMore] = useState<boolean | null>(null);

  const harness = pair?.harness ?? defaultHarness;
  const capability = carried.find((h) => h.name === harness);
  const model = pair?.harness === harness ? (pair.model ?? null) : null;
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    model,
  );
  const catalogModels = useHarnessCatalogModels(agentId, harness, {
    unattached: true,
  });
  const groups = modelGroups(catalogModels.data, catalogModels.granted);
  const runsHarness = (name: string, providerId: string) => {
    const fit = providerOptions(name, views, granted, owned);
    return [...fit.granted, ...fit.addable].some((p) => p.id === providerId);
  };
  const harnessNames = harnesses.filter((name) =>
    owned.some((p) => runsHarness(name, p.id)),
  );
  const catalogEntries = familyModelGroups(groups);
  const familyEntries = (expanded: boolean): Entry[] =>
    catalogEntries.families.flatMap((section) =>
      (expanded ? section.expanded : section.newest).map((entry) => ({
        ...entry,
        family: section.family.name,
      })),
    );
  const entryLabel = (entry: Entry) =>
    entry.family ? `${entry.family} ${entry.label}` : entry.label;
  const allEntries: Entry[] = [
    ...familyEntries(true),
    ...catalogEntries.other.models,
  ];
  const shownEntries: Entry[] = [
    ...familyEntries(older),
    ...catalogEntries.other.models,
  ];
  const entryOf = (name: string | null): Entry | null =>
    allEntries.find((entry) =>
      entry.options.some((o) => sameModel(o.model.name, name)),
    ) ?? null;
  const currentEntry = entryOf(model);
  const subagent = subagentOf(pair);
  const subEntry = entryOf(subagent?.model ?? null);
  const subProvider =
    findModel(groups, subagent?.model ?? null)?.group.connectionId ??
    providerOfModel(subagent?.model, owned)?.id;
  const offering = (entry: Entry | null, providerId: string | undefined) =>
    entry === null
      ? providerId !== undefined && runsHarness(harness, providerId)
      : entry.options.some((o) => o.group.connectionId === providerId);
  /* UNIT_BOUNDARY_DESCRIPTION: the shown provider is the option whose own model name the pair holds; an unlisted model names its Connection by its qualified alias, and with no match the row shows nothing rather than the stale field a pinned model leaves behind. */
  const currentOption =
    currentEntry?.options.find((o) => sameModel(o.model.name, model)) ??
    currentEntry?.options.find(
      (o) => o.group.connectionId === pair?.provider,
    ) ??
    currentEntry?.options[0];
  const aliasProvider =
    model !== null ? providerOfModel(model, owned) : undefined;
  const providerId =
    currentOption?.group.connectionId ??
    (model !== null ? aliasProvider?.id : pair?.provider);
  const provider =
    owned.find((p) => p.id === providerId) ??
    (model === null
      ? owned.find((p) => runsHarness(harness, p.id))
      : undefined);
  const subOption =
    subEntry?.options.find((o) => o.group.connectionId === subProvider) ??
    subEntry?.options[0];
  const subagentProvider = owned.find(
    (p) => p.id === (subOption?.group.connectionId ?? subProvider),
  );
  const listingIssue = (providerId: string): string | null => {
    const group = groups.find((g) => g.connectionId === providerId);
    if (group === undefined) return null;
    if (group.models.length > 0)
      return group.status === "unavailable"
        ? "Couldn't refresh this provider's models; showing its last listing."
        : null;
    return group.status === "unavailable"
      ? "Couldn't list this provider's models."
      : group.status === "unsupported"
        ? "This harness doesn't support this provider."
        : "This provider lists no models.";
  };
  const providerUsable = (entry: Entry | null, providerId: string) =>
    offering(entry, providerId);
  const providerReason = (
    entry: Entry | null,
    providerId: string,
    name: string,
  ): string | null =>
    listingIssue(providerId) ??
    (offering(entry, providerId)
      ? null
      : entry === null
        ? `Doesn't run ${harnessDisplayName(name, views) ?? name}`
        : `Doesn't offer ${entryLabel(entry)} for ${harnessDisplayName(name, views) ?? name}`);
  /* UNIT_BOUNDARY_DESCRIPTION: the model listing's own state, so a first-load failure and a failed provider reading are told apart from an empty success and from a provider that simply lacks the model. */
  const modelStatus = catalogModels.isLoading
    ? "loading"
    : catalogModels.isError
      ? "failed"
      : groups.length === 0 ||
          groups.every((g) => g.models.length === 0 && g.status === "listed")
        ? "empty"
        : "listed";
  const failedListings = groups.filter(
    (g) => g.models.length === 0 && g.status === "unavailable",
  );
  const staleListings = groups.filter(
    (g) => g.models.length > 0 && g.status === "unavailable",
  );
  const effort = sessionSettingOptions(capability).find(
    (o) => o.category === "thought_level" && !o.subagents,
  );
  const allowed = effort
    ? modelConstraintsFor(capability?.harnessConfigCatalog, model)?.[effort.id]
    : undefined;
  const effortChoices = (effort?.choices ?? []).filter(
    (c) => !allowed || allowed.includes(c.value),
  );
  const effortValue =
    effort === undefined
      ? undefined
      : (settings[effort.id] ?? defaults[effort.id] ?? effort.default);
  const modelName = model ? (prettyModelLabel(model) ?? model) : "";

  const choose = (next: SessionPair, intent: PickerIntent = "primary") =>
    onChoose(next, intent);
  const pickOption = (option: ModelOption) =>
    connectOnPick(option.group, option.model.name, () =>
      choose({
        harness,
        provider: option.group.connectionId,
        model: option.model.name,
        ...keepSettings(
          settingsForModel(capability, groups, option.model.name, settings),
        ),
      }),
    );
  const pickEntry = (key: string) => {
    const entry = allEntries.find((e) => e.key === key);
    if (!entry) return;
    pickOption(
      entry.options.find((o) => o.group.connectionId === provider?.id) ??
        entry.options[0]!,
    );
  };
  const firstEntryOf = (providerId: string): Entry | null =>
    allEntries.find((entry) =>
      entry.options.some((o) => o.group.connectionId === providerId),
    ) ?? null;
  const changeProvider = (providerId: string) => {
    if (currentEntry) {
      const option = currentEntry.options.find(
        (o) => o.group.connectionId === providerId,
      );
      if (option) return pickOption(option);
    }
    const first = firstEntryOf(providerId);
    if (first === null)
      return choose({ harness, provider: providerId, model: null });
    pickOption(first.options.find((o) => o.group.connectionId === providerId)!);
  };
  const changeHarness = (name: string) => {
    const fit = providerOptions(name, views, granted, owned);
    const next =
      fit.granted.find((p) => p.id === provider?.id) ??
      fit.granted[0] ??
      fit.addable[0];
    choose({ harness: name, provider: next?.id ?? null, model: null });
  };
  const changeSubagentModel = (key: string) => {
    if (!pair) return;
    if (key === "") return choose(withSubagent(pair, null), "subagent-clear");
    const entry = allEntries.find((e) => e.key === key);
    if (!entry) return;
    const option =
      entry.options.find(
        (o) => o.group.connectionId === subagentProvider?.id,
      ) ?? entry.options[0]!;
    connectOnPick(option.group, option.model.name, () =>
      choose(
        withSubagent(pair, { harness, model: option.model.name }),
        "subagent",
      ),
    );
  };
  const changeSubagentProvider = (providerId: string) => {
    if (!pair) return;
    if (providerId === "")
      return choose(withSubagent(pair, null), "subagent-clear");
    if (subEntry) {
      const option = subEntry.options.find(
        (o) => o.group.connectionId === providerId,
      );
      if (!option) return;
      return connectOnPick(option.group, option.model.name, () =>
        choose(
          withSubagent(pair, { harness, model: option.model.name }),
          "subagent",
        ),
      );
    }
    const first = firstEntryOf(providerId);
    if (first === null) return;
    const option = first.options.find(
      (o) => o.group.connectionId === providerId,
    )!;
    connectOnPick(option.group, option.model.name, () =>
      choose(
        withSubagent(pair, { harness, model: option.model.name }),
        "subagent",
      ),
    );
  };

  const expanded = more ?? subagent !== null;
  const moreId = `${uid}-more`;
  const pickProfile = (profile: ProfileWithUsage) => {
    const { available, attachable } = profile.availability ?? {
      available: true,
      attachable: false,
    };
    if (!available) return;
    if (profile.subagent) setMore(true);
    if (attachable && onPickProfile)
      void attach(profile).then((id) => id && onPickProfile(profile, id));
    else onPickProfile?.(profile);
  };
  const follow = agentDefault;
  const followingPair = follow?.active ? follow.pair : null;
  const followingProvider = followingPair
    ? (owned.find((p) => p.id === followingPair.provider) ??
      providerOfModel(followingPair.model, owned))
    : undefined;
  const followingCapability = carried.find(
    (h) => h.name === followingPair?.harness,
  );
  const followingEffort = sessionSettingOptions(followingCapability).find(
    (o) => o.category === "thought_level" && !o.subagents,
  );
  const followingEffortValue = followingEffort
    ? (followingPair?.settings?.[followingEffort.id] ?? followingEffort.default)
    : undefined;
  const choiceName = (
    option: { choices: readonly { value: string; name: string }[] } | undefined,
    value: string | undefined,
  ) =>
    value === undefined
      ? undefined
      : (option?.choices.find((c) => c.value === value)?.name ?? value);
  const onProfiles = view === "profiles" && profiles.length > 0;

  return (
    <div className="flex flex-col gap-1 p-1 text-sm">
      {!onProfiles && (
        <>
          {note && <p className="px-1 text-xs text-muted-foreground">{note}</p>}
          {follow && (
            <div className="flex items-center justify-between gap-2 px-1 py-1">
              <span id={`${uid}-follow`}>Use agent default</span>
              <Switch
                checked={follow.active}
                label="Use agent default"
                describedBy={`${uid}-follow`}
                onCheckedChange={(on) =>
                  on ? follow.onActivate() : follow.onDeactivate()
                }
              />
            </div>
          )}
          {follow?.active ? (
            followingPair === null ? (
              <p className="px-1 py-1 text-muted-foreground">
                No default set yet.
              </p>
            ) : (
              <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-1 text-sm">
                <dt className="text-muted-foreground">Harness</dt>
                <dd className="m-0 truncate">
                  {harnessDisplayName(followingPair.harness, views) ??
                    followingPair.harness}
                </dd>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="m-0 truncate">
                  {prettyModelLabel(followingPair.model ?? "") ??
                    followingPair.model ??
                    "Choose a model"}
                </dd>
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="m-0 truncate">
                  {followingProvider?.name ?? "—"}
                </dd>
                {followingEffort && (
                  <>
                    <dt className="text-muted-foreground">
                      {followingEffort.name}
                    </dt>
                    <dd className="m-0 truncate">
                      {choiceName(followingEffort, followingEffortValue) ?? "—"}
                    </dd>
                  </>
                )}
              </dl>
            )
          ) : (
            <>
              {harnessNames.length === 0 ? (
                <p className="px-1 py-1 text-muted-foreground">
                  No provider you hold runs any harness this agent carries.
                </p>
              ) : locked ? (
                <div className="flex items-center gap-3 px-1 py-1">
                  <span className="w-[84px] shrink-0 text-muted-foreground">
                    Harness
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                    <HarnessIcons harnesses={[harness]} size="xs" />
                    {harnessDisplayName(harness, views) ?? harness}
                  </span>
                  <HarnessLock onNewSession={locked.onNewSession} />
                </div>
              ) : (
                <div className={ROW}>
                  <span
                    id={`${uid}-harness-label`}
                    className="text-muted-foreground"
                  >
                    Harness
                  </span>
                  <div className="min-w-0">
                    <HarnessMenu
                      label={`${uid}-harness-label`}
                      options={harnessNames.map((name) => ({
                        name,
                        displayName: harnessDisplayName(name, views) ?? name,
                      }))}
                      current={harness}
                      onPick={changeHarness}
                    />
                  </div>
                </div>
              )}
              <Field id={`${uid}-model`} label="Model">
                <Select
                  id={`${uid}-model`}
                  size="sm"
                  value={currentEntry?.key ?? model ?? ""}
                  onChange={(e) => {
                    if (e.target.value === OLDER_VERSIONS)
                      return setOlder((shown) => !shown);
                    pickEntry(e.target.value);
                  }}
                >
                  {model === null && <option value="">Choose a model</option>}
                  {model !== null && currentEntry === null && (
                    <option value={model}>
                      {prettyModelLabel(model) ?? model}
                    </option>
                  )}
                  {currentEntry !== null &&
                    !shownEntries.some((e) => e.key === currentEntry.key) && (
                      <option value={currentEntry.key}>
                        {entryLabel(currentEntry)}
                      </option>
                    )}
                  {catalogEntries.families.map((section) => {
                    const list = older ? section.expanded : section.newest;
                    if (list.length === 0) return null;
                    return (
                      <optgroup
                        key={section.family.token}
                        label={section.family.name}
                      >
                        {list.map((entry) => (
                          <option key={entry.key} value={entry.key}>
                            {`${section.family.name} ${entry.label}`}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                  {catalogEntries.other.models.length > 0 && (
                    <optgroup label="Other">
                      {catalogEntries.other.models.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {catalogEntries.families.some((s) => s.more.length > 0) && (
                    <option value={OLDER_VERSIONS}>
                      {older ? "Hide older versions" : "Show older versions"}
                    </option>
                  )}
                </Select>
              </Field>
              {modelStatus === "loading" && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                  <Spinner size={12} />
                  Loading models…
                </p>
              )}
              {modelStatus === "failed" && (
                <p className="px-1 text-xs text-muted-foreground">
                  Couldn't load the models.
                  <RetryModels onRetry={() => void catalogModels.refetch()} />
                </p>
              )}
              {modelStatus === "empty" && (
                <p className="px-1 text-xs text-muted-foreground">
                  No models available.
                </p>
              )}
              {failedListings.map((group) => (
                <p
                  key={group.connectionId}
                  className="px-1 text-xs text-muted-foreground"
                >
                  {group.displayName}: Couldn't list this provider's models.
                  <RetryModels onRetry={() => void catalogModels.refetch()} />
                </p>
              ))}
              {staleListings.map((group) => (
                <p
                  key={group.connectionId}
                  className="px-1 text-xs text-muted-foreground"
                >
                  {group.displayName}: Couldn't refresh its models; showing its
                  last listing.
                  <RetryModels onRetry={() => void catalogModels.refetch()} />
                </p>
              ))}
              {owned.length > 1 ? (
                <div className={ROW}>
                  <span className="text-muted-foreground">Provider</span>
                  <div className="min-w-0">
                    <ProviderMenu
                      label="Provider"
                      providers={owned}
                      currentId={provider?.id}
                      enabled={(id) => providerUsable(currentEntry, id)}
                      reason={(id) => providerReason(currentEntry, id, harness)}
                      onPick={changeProvider}
                      onManage={onManageProviders}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-1 py-1">
                  <span className="w-[84px] shrink-0 text-muted-foreground">
                    Provider
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {provider?.name ?? "No provider"}
                  </span>
                  <button
                    type="button"
                    onClick={onManageProviders}
                    className="shrink-0 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
              {effort &&
                (effortChoices.length === 0 ? (
                  <div className={ROW}>
                    <span className="text-muted-foreground">{effort.name}</span>
                    <span className="text-muted-foreground">
                      Not available for {modelName}
                    </span>
                  </div>
                ) : (
                  <Field id={`${uid}-effort`} label={effort.name}>
                    <Select
                      id={`${uid}-effort`}
                      size="sm"
                      value={effortValue ?? ""}
                      onChange={(e) =>
                        choose({
                          harness,
                          provider: provider?.id ?? null,
                          model,
                          ...keepSettings(
                            applySettingChanges(settings, {
                              [effort.id]: e.target.value,
                            }),
                          ),
                        })
                      }
                    >
                      {effortValue !== undefined &&
                        !effortChoices.some((c) => c.value === effortValue) && (
                          <option value={effortValue}>{effortValue}</option>
                        )}
                      {effortChoices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
            </>
          )}
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={() => setMore(!expanded)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={cn("transition-transform", expanded && "rotate-180")}
              />
              More options
            </button>
            {expanded && (
              <div className="flex flex-col items-end">{saveAsProfile}</div>
            )}
          </div>
          {expanded && (
            <div id={moreId} className="flex flex-col">
              {pair && (
                <>
                  <h3 className={cn("px-1 pt-1", labelVariants())}>
                    Subagents
                  </h3>
                  <Field id={`${uid}-subagent-model`} label="Model">
                    <Select
                      id={`${uid}-subagent-model`}
                      size="sm"
                      value={subEntry?.key ?? subagent?.model ?? ""}
                      onChange={(e) => {
                        if (e.target.value === OLDER_VERSIONS)
                          return setOlder((shown) => !shown);
                        changeSubagentModel(e.target.value);
                      }}
                    >
                      <option value="">Same as agent</option>
                      {subagent && subEntry === null && (
                        <option value={subagent.model}>
                          {prettyModelLabel(subagent.model) ?? subagent.model}
                        </option>
                      )}
                      {subEntry !== null &&
                        !shownEntries.some((e) => e.key === subEntry.key) && (
                          <option value={subEntry.key}>
                            {entryLabel(subEntry)}
                          </option>
                        )}
                      {shownEntries.map((entry) => (
                        <option key={entry.key} value={entry.key}>
                          {entryLabel(entry)}
                        </option>
                      ))}
                      {catalogEntries.families.some(
                        (s) => s.more.length > 0,
                      ) && (
                        <option value={OLDER_VERSIONS}>
                          {older
                            ? "Hide older versions"
                            : "Show older versions"}
                        </option>
                      )}
                    </Select>
                  </Field>
                  {owned.length > 1 && (
                    <div className={ROW}>
                      <span className="text-muted-foreground">Provider</span>
                      <div className="min-w-0">
                        <ProviderMenu
                          label="Subagent provider"
                          providers={owned}
                          currentId={subagentProvider?.id}
                          enabled={(id) => providerUsable(subEntry, id)}
                          reason={(id) => providerReason(subEntry, id, harness)}
                          none={{
                            label: "Same as agent",
                            onPick: () => changeSubagentProvider(""),
                          }}
                          onPick={changeSubagentProvider}
                        />
                      </div>
                    </div>
                  )}
                  <div className="px-1 pt-1 empty:hidden">
                    <SessionSettingsControls
                      agentId={agentId}
                      carried={carried}
                      capability={capability}
                      model={model}
                      settings={settings}
                      defaults={defaults}
                      skip={effort ? [effort.id] : []}
                      onChange={(changes) =>
                        choose({
                          harness,
                          provider: provider?.id ?? null,
                          model,
                          ...keepSettings(
                            applySettingChanges(settings, changes),
                          ),
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
      {!onProfiles ? (
        profiles.length > 0 && (
          <>
            <hr className="mx-1 border-border" />
            <button
              type="button"
              onClick={() => setView("profiles")}
              className="flex items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted"
            >
              <span className="min-w-0 flex-1">Use a profile</span>
              <span className="text-xs text-muted-foreground">
                {profiles.length}
              </span>
              <ChevronRight size={14} aria-hidden className="shrink-0" />
            </button>
          </>
        )
      ) : (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setView("custom");
              onLeaveProfiles?.();
            }}
            className="flex items-center gap-1 self-start rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft size={14} aria-hidden />
            Back to custom
          </button>
          <div className="flex items-center justify-between px-1">
            <h3 className={labelVariants()}>Saved profiles</h3>
            <button
              type="button"
              onClick={onManageProfiles}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              Manage
            </button>
          </div>
          <ul className="flex flex-col">
            {sortProfiles(profiles).map((profile) => {
              const selected = profile.id === selectedProfileId;
              const availability = profile.availability ?? {
                available: true,
                reason: null,
                attachable: false,
              };
              return (
                <li
                  key={profile.id}
                  className={cn("rounded", selected && "bg-muted")}
                >
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    disabled={!availability.available}
                    title={availability.reason ?? undefined}
                    onClick={() => pickProfile(profile)}
                    className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                  >
                    <HarnessIcons harnesses={[profile.harness]} size="xs" />
                    <span className={cn("truncate", selected && "font-medium")}>
                      {profile.name}
                    </span>
                    <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {availability.available &&
                        !selected &&
                        (prettyModelLabel(profile.model) ?? profile.model)}
                      {selected && <Checkmark size={16} aria-hidden />}
                    </span>
                  </button>
                  {!availability.available && (
                    <div className="flex items-start gap-2 px-2 pb-1.5 pl-8 text-xs text-muted-foreground">
                      <span className="min-w-0 whitespace-normal">
                        {availability.reason ?? "This profile cannot run here."}
                      </span>
                      <button
                        type="button"
                        onClick={onManageProviders}
                        className="shrink-0 text-accent underline-offset-2 hover:underline"
                      >
                        Configure providers
                      </button>
                    </div>
                  )}
                  {selected && (
                    <div className="pb-2 pl-8 pr-2">
                      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                        {profileDetailRows(
                          profile,
                          carried.find((h) => h.name === profile.harness),
                          harnessDisplayName(profile.harness, views) ??
                            profile.harness,
                        ).map(({ label, value }) => (
                          <Fragment key={label}>
                            <dt className="m-0 text-muted-foreground">
                              {label}
                            </dt>
                            <dd className="m-0 break-words">{value}</dd>
                          </Fragment>
                        ))}
                      </dl>
                      <button
                        type="button"
                        onClick={() => onEditProfile?.(profile)}
                        className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
                      >
                        Edit profile
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const ROW = "grid grid-cols-[84px_minmax(0,1fr)] items-center gap-3 px-1 py-1";

function HarnessMenu({
  label,
  options,
  current,
  onPick,
}: {
  label: string;
  options: readonly { name: string; displayName: string }[];
  current: string;
  onPick: (name: string) => void;
}) {
  const selected = options.find((option) => option.name === current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-labelledby={label}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-xs text-foreground"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <HarnessIcons harnesses={[current]} size="xs" />
            <span className="truncate">{selected?.displayName ?? current}</span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={current} onValueChange={onPick}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.name} value={option.name}>
              <span className="flex items-center gap-2">
                <HarnessIcons harnesses={[option.name]} size="xs" />
                <span>{option.displayName}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RetryModels({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="link" size="inline" className="ml-1" onClick={onRetry}>
      Retry
    </Button>
  );
}

function ProviderMenu({
  label,
  providers,
  currentId,
  enabled,
  reason,
  onPick,
  onManage,
  none,
}: {
  label: string;
  providers: readonly { id: string; name: string }[];
  currentId: string | undefined;
  enabled: (id: string) => boolean;
  reason: (id: string) => string | null;
  onPick: (id: string) => void;
  onManage?: () => void;
  /** UNIT_BOUNDARY_DESCRIPTION: the empty choice a subagent slot has, "Same as agent", which no provider id stands for. */
  none?: { label: string; onPick: () => void };
}) {
  const current = providers.find((p) => p.id === currentId)?.name;
  const shown =
    current ??
    (none !== undefined && currentId === undefined
      ? none.label
      : "No provider");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${shown}`}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-xs text-foreground"
        >
          <span className="truncate">{shown}</span>
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {none && (
          <DropdownMenuItem onSelect={none.onPick}>
            {none.label}
          </DropdownMenuItem>
        )}
        {providers.map((p) => {
          const usable = enabled(p.id);
          const why = reason(p.id);
          return (
            <DropdownMenuItem
              key={p.id}
              disabled={!usable}
              onSelect={() => onPick(p.id)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{p.name}</span>
                {why !== null && (
                  <span className="whitespace-normal text-xs text-muted-foreground">
                    {why}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
        {onManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManage}>
              Manage providers
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={ROW}>
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function HarnessLock({ onNewSession }: { onNewSession: () => void }) {
  return (
    <Popover>
      <Tooltip content="Why can't I change the harness?">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Why can't I change the harness?"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Information size={14} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="w-60 p-3 text-sm">
        <p>
          The harness is set when a session starts. To use a different one,{" "}
          <PopoverClose asChild>
            <button
              type="button"
              onClick={onNewSession}
              className="text-accent underline-offset-2 hover:underline"
            >
              start a new session
            </button>
          </PopoverClose>
          .
        </p>
      </PopoverContent>
    </Popover>
  );
}

function keepSettings(settings: Record<string, string>): {
  settings?: Record<string, string>;
} {
  return Object.keys(settings).length > 0 ? { settings } : {};
}
