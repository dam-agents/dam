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
import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { HARNESS_ORDER, HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  isModelOption,
  sessionSettingOptions,
  settingDefaults,
  settingsForModel,
} from "../lib/session-settings.js";
import { subagentOf, withSubagent } from "../lib/subagent-choice.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

const ROW =
  "grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 px-4 py-1.5";
const LABEL = "text-[13px] text-muted-foreground";
const CONTROL =
  "flex h-[38px] w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground";

interface MenuSection {
  title: string;
  entries: {
    key: string;
    label: string;
    harness?: string;
    description?: string;
  }[];
}

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
  pair: pairProp,
  defaultHarness,
  locked,
  note,
  profiles = [],
  selectedProfileId = null,
  providerTriggerRef,
  initialFocus,
  onPickProfile,
  onManageProfiles,
  onEditProfile,
  profileHarness,
  defaultPair,
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
  /** UNIT_BOUNDARY_DESCRIPTION: opens that profile's editor on the Settings › Profiles page. */
  onEditProfile?: (profile: ProfileWithUsage) => void;
  /** UNIT_BOUNDARY_DESCRIPTION: an open session offers only the profiles that run on its harness, and says so when none does. */
  profileHarness?: string;
  /** UNIT_BOUNDARY_DESCRIPTION: the pair this pick follows: with no model picked, the Provider row shows that default's Connection when that default names this harness and the Connection runs it, and a harness or provider pick that keeps no model of its own starts on that default's model where the new harness listing and Connection offer it. */
  defaultPair?: SessionPair | null;
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
  /** UNIT_BOUNDARY_DESCRIPTION: the Provider row's trigger, which a caller focuses when the question that opened the panel is which provider to use. */
  providerTriggerRef?: React.Ref<HTMLButtonElement>;
  /** UNIT_BOUNDARY_DESCRIPTION: the row a caller asked the panel to land on, which is on the fields and never on the saved profiles. */
  initialFocus?: "provider";
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
  /* UNIT_BOUNDARY_DESCRIPTION: the profiles this panel can offer at all: those on the session's own harness, whose harness it can offer — one the agent does not carry, or one its owner's feature leaves out, can never be picked here — and which the owner catalog says can run. */
  const fitProfiles = sortProfiles(
    profiles.filter(
      (profile) =>
        (profileHarness === undefined || profile.harness === profileHarness) &&
        (harnesses.length === 0 || harnesses.includes(profile.harness)) &&
        (profile.availability?.available ?? true),
    ),
  );
  /* UNIT_BOUNDARY_DESCRIPTION: the panel opens on the fields while the profile in use is the only one to choose from, since a list of one is a screen with nothing to pick; two or more open on their list, which is what the picker is for then. A caller that asked for the Provider row starts on the fields too, since that row is not on the list. */
  const [view, setView] = useState<"custom" | "profiles">(() =>
    initialFocus !== "provider" && fitProfiles.length > 1 && selectedProfileId
      ? "profiles"
      : "custom",
  );
  const [more, setMore] = useState<boolean | null>(null);
  const pair = pairProp;
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const harnessTrigger = useRef<HTMLButtonElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const lastView = useRef(view);
  /* UNIT_BOUNDARY_DESCRIPTION: switching between the custom fields and the profiles view unmounts the button that switched, so focus moves to the first control of the view that appears. */
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    if (view === "profiles") return backRef.current?.focus();
    (
      harnessTrigger.current ??
      modelTrigger.current ??
      bodyRef.current?.querySelector<HTMLButtonElement>("button")
    )?.focus();
  }, [view]);

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
  /* UNIT_BOUNDARY_DESCRIPTION: the shown provider is the option that is both on the pair's own Connection and the pair's model, even where another Connection of the same alias lists the same model name; a family tier can hold another provider's name for the model, so the model alone comes next and the Connection alone after it. An unlisted model names its Connection by its qualified alias, and with no match the row shows nothing rather than the stale field a pinned model leaves behind. */
  const currentOption =
    currentEntry?.options.find(
      (o) =>
        o.group.connectionId === pair?.provider &&
        sameModel(o.model.name, model),
    ) ??
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
      ? (owned.find(
          (p) =>
            defaultPair?.harness === harness &&
            p.id === defaultPair.provider &&
            runsHarness(harness, p.id),
        ) ?? owned.find((p) => runsHarness(harness, p.id)))
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
  const orderedHarnessNames = [
    ...HARNESS_ORDER.filter((name) => harnessNames.includes(name)),
    ...harnessNames.filter((name) => !HARNESS_ORDER.includes(name as never)),
  ];
  /* UNIT_BOUNDARY_DESCRIPTION: one family section of the model menus, the current entry kept visible when the older versions are collapsed, and Other last. */
  const modelSections = (current: Entry | null): MenuSection[] => {
    const sections: MenuSection[] = catalogEntries.families.flatMap(
      (section) => {
        const list = older ? section.expanded : section.newest;
        const entries = list.map((entry) => ({
          key: entry.key,
          label: `${section.family.name} ${entry.label}`,
        }));
        if (
          current?.family === section.family.name &&
          !entries.some((entry) => entry.key === current.key)
        )
          entries.push({ key: current.key, label: entryLabel(current) });
        return entries.length === 0
          ? []
          : [{ title: section.family.name, entries }];
      },
    );
    if (catalogEntries.other.models.length > 0)
      sections.push({
        title: "Other",
        entries: catalogEntries.other.models.map((entry) => ({
          key: entry.key,
          label: entry.label,
        })),
      });
    return sections;
  };
  const olderAvailable = catalogEntries.families.some(
    (section) => section.more.length > 0,
  );
  const olderFoot = olderAvailable
    ? {
        label: older ? "Hide older versions" : "Show older versions",
        onSelect: () => setOlder(!older),
      }
    : undefined;
  const modelDisplay = currentEntry
    ? entryLabel(currentEntry)
    : model
      ? (prettyModelLabel(model) ?? model)
      : "Choose a model";
  const subagentDisplay = subagent
    ? subEntry
      ? entryLabel(subEntry)
      : (prettyModelLabel(subagent.model) ?? subagent.model)
    : "Same as agent";

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
  /* UNIT_BOUNDARY_DESCRIPTION: a pick that keeps no model of its own — none picked, or the picked one off the new harness or Connection — starts on the model the default it follows names, when that listing and this Connection offer it. */
  const inheritedEntry = (
    entries: readonly Entry[],
    providerId: string | undefined,
  ): Entry | null => {
    const inherited = defaultPair?.model ?? null;
    if (inherited === null) return null;
    return (
      entries.find((entry) =>
        entry.options.some(
          (o) =>
            sameModel(o.model.name, inherited) &&
            (providerId === undefined || o.group.connectionId === providerId),
        ),
      ) ?? null
    );
  };
  const changeProvider = (providerId: string) => {
    if (currentEntry) {
      const option = currentEntry.options.find(
        (o) => o.group.connectionId === providerId,
      );
      if (option) return pickOption(option);
    }
    const first =
      inheritedEntry(allEntries, providerId) ?? firstEntryOf(providerId);
    if (first === null)
      return choose({ harness, provider: providerId, model: null });
    pickOption(first.options.find((o) => o.group.connectionId === providerId)!);
  };
  /* UNIT_BOUNDARY_DESCRIPTION: a harness change keeps the model the new harness offers, the same model on another provider counting, else the model the default it follows names, else the chosen provider's first model, else the first model the harness lists; a model only waits when the harness lists none. */
  const changeHarness = (name: string) => {
    const fit = providerOptions(name, views, granted, owned);
    const nextProvider =
      fit.granted.find((p) => p.id === provider?.id) ??
      fit.granted.find((p) => p.id === defaultPair?.provider) ??
      fit.granted[0] ??
      fit.addable[0];
    const nextGroups = catalogModels.forHarness(name) ?? [];
    const nextEntries = familyModelGroups(nextGroups);
    const offered = [
      ...nextEntries.families.flatMap((section) => section.expanded),
      ...nextEntries.other.models,
    ];
    const current =
      model === null
        ? undefined
        : offered.find((entry) =>
            entry.options.some((o) => sameModel(o.model.name, model)),
          );
    const kept = current ?? inheritedEntry(offered, nextProvider?.id);
    const keptOption =
      kept?.options.find((o) => o.group.connectionId === nextProvider?.id) ??
      kept?.options[0];
    const providerGroup = nextGroups.find(
      (g) => g.connectionId === nextProvider?.id,
    );
    const firstOfProvider = providerGroup
      ? (familyModelGroups([providerGroup]).families[0]?.newest[0] ??
        familyModelGroups([providerGroup]).other.models[0])
      : undefined;
    const firstOfHarness =
      nextEntries.families[0]?.newest[0] ?? nextEntries.other.models[0];
    const fallback =
      firstOfProvider?.options[0] ?? firstOfHarness?.options[0] ?? null;
    const nextModel = keptOption ?? fallback;
    const nextCapability = carried.find((h) => h.name === name);
    const keptSettings = nextModel
      ? settingsForModel(
          nextCapability,
          nextGroups,
          nextModel.model.name,
          settings,
        )
      : settings;
    choose({
      harness: name,
      provider: nextModel?.group.connectionId ?? nextProvider?.id ?? null,
      model: nextModel?.model.name ?? null,
      ...keepSettings(keptSettings),
    });
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

  const settingDiffers = sessionSettingOptions(capability).some(
    (option) =>
      !option.subagents &&
      option.category !== "mode" &&
      option.category !== "approvals" &&
      option.id !== effort?.id &&
      !isModelOption(option) &&
      settings[option.id] !== undefined &&
      settings[option.id] !== defaults[option.id],
  );
  const expanded = more ?? (subagent !== null || settingDiffers);
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
  const followSubagent = followingPair ? subagentOf(followingPair) : null;
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
  const effortField =
    effort &&
    (effortChoices.length === 0 ? (
      <div className={ROW}>
        <span className={LABEL}>{effort.name}</span>
        <span className="text-[13px] text-muted-foreground">
          {modelName} has no {effort.name.toLowerCase()} levels
        </span>
      </div>
    ) : (
      <MenuField id={`${uid}-effort-label`} label={effort.name}>
        <ValueMenu
          labelId={`${uid}-effort-label`}
          menuLabel={effort.name}
          display={choiceName(effort, effortValue) ?? ""}
          currentKey={effortValue ?? ""}
          sections={[
            {
              title: "",
              entries: [
                ...(effortValue !== undefined &&
                !effortChoices.some((c) => c.value === effortValue)
                  ? [{ key: effortValue, label: effortValue }]
                  : []),
                ...effortChoices.map((c) => ({
                  key: c.value,
                  label: c.name,
                })),
              ],
            },
          ]}
          onPick={(value) =>
            choose({
              harness,
              provider: provider?.id ?? null,
              model,
              ...keepSettings(
                applySettingChanges(settings, {
                  [effort.id]: value,
                }),
              ),
            })
          }
        />
      </MenuField>
    ));

  return (
    <div ref={bodyRef} className="flex flex-col text-sm">
      {!onProfiles && (
        <>
          {note && (
            <p className="px-4 text-[13px] text-muted-foreground">{note}</p>
          )}
          {follow && (
            <div className="flex items-center justify-between gap-2 px-4 py-1.5">
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
              <p className="px-4 py-1.5 text-muted-foreground">
                No default set yet.
              </p>
            ) : (
              <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 text-sm">
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
                <p className="px-4 py-1.5 text-muted-foreground">
                  No provider you hold runs any harness this agent carries.
                </p>
              ) : locked ? (
                <div className="flex items-center gap-3 px-4 py-1.5">
                  <span className={cn(LABEL, "w-[84px] shrink-0")}>
                    Harness
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span aria-hidden="true">
                      <HarnessIcons harnesses={[harness]} size="xs" />
                    </span>
                    <span className="truncate">
                      {harnessDisplayName(harness, views) ?? harness}
                    </span>
                    <HarnessLock onNewSession={locked.onNewSession} />
                  </span>
                </div>
              ) : (
                <MenuField id={`${uid}-harness-label`} label="Harness">
                  <ValueMenu
                    labelId={`${uid}-harness-label`}
                    menuLabel="Harness"
                    display={harnessDisplayName(harness, views) ?? harness}
                    currentKey={harness}
                    leading={<HarnessIcons harnesses={[harness]} size="xs" />}
                    sections={[
                      {
                        title: "",
                        entries: orderedHarnessNames.map((name) => ({
                          key: name,
                          label: harnessDisplayName(name, views) ?? name,
                          harness: name,
                          description: views.find((view) => view.name === name)
                            ?.description,
                        })),
                      },
                    ]}
                    triggerRef={harnessTrigger}
                    onPick={changeHarness}
                    width="w-[270px]"
                  />
                </MenuField>
              )}
              <MenuField id={`${uid}-model-label`} label="Model">
                <ValueMenu
                  labelId={`${uid}-model-label`}
                  menuLabel="Model"
                  display={modelDisplay}
                  currentKey={currentEntry?.key ?? model ?? ""}
                  sections={modelSections(currentEntry)}
                  foot={olderFoot}
                  triggerRef={modelTrigger}
                  onPick={pickEntry}
                />
              </MenuField>
              {modelStatus === "loading" && (
                <p className="flex items-center gap-1.5 px-4 text-[13px] text-muted-foreground">
                  <Spinner size={12} />
                  Loading models…
                </p>
              )}
              {modelStatus === "failed" && (
                <p className="px-4 text-[13px] text-muted-foreground">
                  Couldn't load the models.
                  <RetryModels onRetry={() => void catalogModels.refetch()} />
                </p>
              )}
              {modelStatus === "empty" && (
                <p className="px-4 text-[13px] text-muted-foreground">
                  No models available.
                </p>
              )}
              {failedListings.map((group) => (
                <p
                  key={group.connectionId}
                  className="px-4 text-[13px] text-muted-foreground"
                >
                  {group.displayName}: Couldn't list this provider's models.
                  <RetryModels onRetry={() => void catalogModels.refetch()} />
                </p>
              ))}
              {staleListings.map((group) => (
                <p
                  key={group.connectionId}
                  className="px-4 text-[13px] text-muted-foreground"
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
                      triggerRef={providerTriggerRef}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-1.5">
                  <span className={cn(LABEL, "w-[84px] shrink-0")}>
                    Provider
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {provider?.name ?? "No provider"}
                  </span>
                  <button
                    type="button"
                    onClick={onManageProviders}
                    className="shrink-0 text-[13px] text-accent underline-offset-2 hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
              {pair && effortField}
            </>
          )}
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            {!(follow?.active && followSubagent === null) && (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={moreId}
                onClick={() => setMore(!expanded)}
                className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={cn(
                    "transition-transform",
                    expanded && "rotate-180",
                  )}
                />
                More options
              </button>
            )}
            {expanded && (
              <div className="flex flex-col items-end">{saveAsProfile}</div>
            )}
          </div>
          {expanded && (
            <div id={moreId} className="flex flex-col">
              {follow?.active ? (
                <>
                  {followSubagent && (
                    <>
                      <h3 className={cn("px-4 pt-2", labelVariants())}>
                        Subagents
                      </h3>
                      <div className={ROW}>
                        <span className={LABEL}>Model</span>
                        <span className="truncate text-sm">
                          {prettyModelLabel(followSubagent.model) ??
                            followSubagent.model}
                        </span>
                      </div>
                      <div className={ROW}>
                        <span className={LABEL}>Provider</span>
                        <span className="truncate text-sm">
                          {followingProvider?.name ?? "—"}
                        </span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                pair && (
                  <>
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
                    <h3 className={cn("px-4 pt-2", labelVariants())}>
                      Subagents
                    </h3>
                    <MenuField id={`${uid}-subagent-model-label`} label="Model">
                      <ValueMenu
                        labelId={`${uid}-subagent-model-label`}
                        menuLabel="Subagent model"
                        display={subagentDisplay}
                        currentKey={subEntry?.key ?? subagent?.model ?? ""}
                        top={{ key: "", label: "Same as agent" }}
                        sections={modelSections(subEntry)}
                        foot={olderFoot}
                        onPick={changeSubagentModel}
                      />
                    </MenuField>
                    {owned.length > 1 && (
                      <div className={ROW}>
                        <span className={LABEL}>Provider</span>
                        <div className="min-w-0">
                          <ProviderMenu
                            label="Subagent provider"
                            providers={owned}
                            currentId={subagentProvider?.id}
                            enabled={(id) => providerUsable(subEntry, id)}
                            reason={(id) =>
                              providerReason(subEntry, id, harness)
                            }
                            none={{
                              label: "Same as agent",
                              onPick: () => changeSubagentProvider(""),
                            }}
                            onPick={changeSubagentProvider}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          )}
        </>
      )}
      {!onProfiles ? (
        profiles.length > 0 && (
          <>
            <hr className="mx-3 mt-4.5 border-border" />
            <button
              type="button"
              onClick={() => setView("profiles")}
              className="mx-3 mt-3 flex min-h-[38px] items-center gap-1.5 rounded px-1 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">
                {selectedProfileId
                  ? `Using profile “${profiles.find((p) => p.id === selectedProfileId)?.name ?? ""}”`
                  : "Use a profile"}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {profiles.length}
              </span>
              <ChevronRight size={14} aria-hidden className="shrink-0" />
            </button>
          </>
        )
      ) : (
        <div className="flex flex-col gap-1 px-3">
          <button
            ref={backRef}
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
              className="text-[13px] text-accent underline-offset-2 hover:underline"
            >
              Manage
            </button>
          </div>
          {fitProfiles.length === 0 && (
            <p className="px-4 py-2 text-[13px] text-muted-foreground">
              No profiles fit this session.
            </p>
          )}
          <ul className="flex flex-col">
            {fitProfiles.map((profile) => {
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
                    className="flex min-h-[38px] w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                  >
                    <HarnessIcons harnesses={[profile.harness]} size="xs" />
                    <span className={cn("truncate", selected && "font-medium")}>
                      {profile.name}
                    </span>
                    <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
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
                      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
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
                        className="mt-1 text-[13px] text-accent underline-offset-2 hover:underline"
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

export function ValueMenu({
  labelId,
  menuLabel,
  display,
  currentKey,
  sections,
  top,
  foot,
  leading,
  onPick,
  triggerRef,
  width = "w-[270px]",
}: {
  labelId: string;
  menuLabel: string;
  display: string;
  currentKey: string;
  sections: readonly MenuSection[];
  top?: { key: string; label: string };
  foot?: { label: string; onSelect: () => void };
  leading?: ReactNode;
  onPick: (key: string) => void;
  /** UNIT_BOUNDARY_DESCRIPTION: the caller focuses the trigger when a view switch lands on this field. */
  triggerRef?: React.Ref<HTMLButtonElement>;
  width?: string;
}) {
  const valueId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-labelledby={`${labelId} ${valueId}`}
          className={CONTROL}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {leading}
            <span id={valueId} className="truncate">
              {display}
            </span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        aria-label={menuLabel}
        className={cn("max-h-[340px] overflow-y-auto", width)}
      >
        <DropdownMenuRadioGroup value={currentKey} onValueChange={onPick}>
          {top && (
            <DropdownMenuRadioItem value={top.key} indicator="check">
              {top.label}
            </DropdownMenuRadioItem>
          )}
          {sections.map((section) => (
            <Fragment key={section.title || "none"}>
              {section.title !== "" && (
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-muted-foreground">
                  {section.title}
                </DropdownMenuLabel>
              )}
              {section.entries.map((entry) => (
                <DropdownMenuRadioItem
                  key={entry.key}
                  value={entry.key}
                  indicator="check"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {entry.harness && (
                      <span aria-hidden="true">
                        <HarnessIcons harnesses={[entry.harness]} size="xs" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate">{entry.label}</span>
                      {entry.description && (
                        <span className="block whitespace-normal text-[12px] leading-snug text-muted-foreground">
                          {entry.description}
                        </span>
                      )}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
        {foot && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                foot.onSelect();
              }}
              className="text-[13px] text-accent"
            >
              {foot.label}
            </DropdownMenuItem>
          </>
        )}
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

function MenuField({
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
      <span id={id} className={LABEL}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
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
  triggerRef,
}: {
  label: string;
  providers: readonly { id: string; name: string }[];
  currentId: string | undefined;
  enabled: (id: string) => boolean;
  reason: (id: string) => string | null;
  onPick: (id: string) => void;
  onManage?: () => void;
  triggerRef?: React.Ref<HTMLButtonElement>;
  /** UNIT_BOUNDARY_DESCRIPTION: the empty choice a subagent slot has, "Same as agent", which no provider id stands for. */
  none?: { label: string; onPick: () => void };
}) {
  const current = providers.find((p) => p.id === currentId)?.name;
  const shown =
    current ??
    (none !== undefined && currentId === undefined
      ? none.label
      : "No provider");
  const pick = (value: string) => {
    if (value === "") return none?.onPick();
    if (enabled(value)) onPick(value);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${label}: ${shown}`}
          className={CONTROL}
        >
          <span className="truncate">{shown}</span>
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 text-muted-foreground"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        aria-label={label}
        className="w-[270px]"
      >
        <DropdownMenuRadioGroup
          value={currentId ?? (none !== undefined ? "" : "")}
          onValueChange={pick}
        >
          {none && (
            <DropdownMenuRadioItem value="" indicator="check">
              {none.label}
            </DropdownMenuRadioItem>
          )}
          {providers.map((p) => {
            const usable = enabled(p.id);
            const why = reason(p.id);
            return (
              <Tooltip key={p.id} content={why} side="right">
                <DropdownMenuRadioItem
                  value={p.id}
                  indicator="check"
                  aria-disabled={!usable || undefined}
                  onSelect={(event) => {
                    if (!usable) event.preventDefault();
                  }}
                  className={
                    usable
                      ? undefined
                      : "cursor-default opacity-50 data-[highlighted]:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  }
                >
                  <span className="truncate">{p.name}</span>
                </DropdownMenuRadioItem>
              </Tooltip>
            );
          })}
        </DropdownMenuRadioGroup>
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

function HarnessLock({ onNewSession }: { onNewSession: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Why can't I change the harness?"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Information size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        tail={false}
        className="w-60 border-transparent bg-foreground p-3 text-[13px] text-background shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
      >
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
