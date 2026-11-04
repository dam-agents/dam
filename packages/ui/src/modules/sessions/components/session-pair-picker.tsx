import { Add, Unlink, WarningAltFilled } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import {
  isNativeSubagentSetting,
  isPlatformSubagentSetting,
  lentSubagentOfProfile,
} from "agent-runtime-api";
import type {
  ProfileWithUsage,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { useEffect, useState } from "react";

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
import {
  usePickedProfile,
  useSaveAsProfile,
} from "../../profiles/components/save-as-profile.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useSessionDefaults,
} from "../api/session-pair.js";
import { keepOpenWhileDialog } from "../hooks/use-connect-on-pick.js";
import { useNextSessionPair } from "../hooks/use-next-session-pair.js";
import { useProviderUsage } from "../hooks/use-provider-usage.js";
import {
  attachableProviders,
  findModel,
  modelGroups,
  sameModel,
} from "../lib/catalog-groups.js";
import { prettyModelLabel } from "../lib/model-families.js";
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
} from "../lib/session-settings.js";
import {
  heldSubagent,
  pickProfile as profileValues,
  primaryProfileOf,
  subagentOf,
} from "../lib/subagent-choice.js";
import { useAttachProvidersDialog } from "./attach-providers-dialog.js";
import { DetachProviderMessage } from "./detach-provider-message.js";
import { SessionModelPicker } from "./session-model-picker.js";
import {
  SessionPairRowTrigger,
  SessionPairTrigger,
} from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";
import { ToolApprovalPicker } from "./tool-approval-picker.js";

interface CommonProps {
  agentId: string | null;
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
        /** UNIT_BOUNDARY_DESCRIPTION: edits a pick held elsewhere (a profile in Settings, with no agent): every provider the owner holds, and a pick goes to `onChoose`, never to an agent's next session or chat default. `providerName` names a provider the owner does not hold. */
        edit?: {
          pair: SessionPair;
          providerName: string;
          onChoose: (pair: SessionPair) => void;
        };
        /** UNIT_BOUNDARY_DESCRIPTION: the pick a schedule or a channel holds, in the chat default's two slots: the whole picker on those values, and a pick goes to `onChoose` in the chat default's shape, never to the agent's next session or chat default. `placeholder` names what it runs on while neither primary slot is set. */
        target?: {
          slots: SessionChoiceSlots;
          label: string;
          placeholder: string;
          /** UNIT_BOUNDARY_DESCRIPTION: the agent's own default, which this pick follows while neither primary slot is set: a switch on the panel, the values read-only while it is on, and its values copied into the pick when it is switched off. */
          agentDefault?: {
            /** UNIT_BOUNDARY_DESCRIPTION: what the pick follows, a sentence the row card reads under "Use agent default" and the list's first row repeats; with no default set it says so. */
            detail: string;
            harness?: string | undefined;
            pair: SessionPair | null;
            onClear: () => void;
          };
          /** UNIT_BOUNDARY_DESCRIPTION: a destination that keeps the values a run uses and no primary profile reference, as a Channel's or a Schedule's page does. */
          valueOnly?: boolean;
          /** UNIT_BOUNDARY_DESCRIPTION: `pair` is what this destination stores (a profile's values, a slot's own subagent), `references` the slots it stores beside them, and `effective` the values a run shows, with a lent subagent materialized for a destination that keeps only values. False means the write failed. */
          onChoose: (
            pair: SessionPair,
            references: SessionChoiceReferences,
            effective?: SessionPair,
          ) => void | Promise<boolean>;
        };
        /** UNIT_BOUNDARY_DESCRIPTION: a config page has room for the pick as a row card, titled and set apart, where the chat's picker carries its values inline. */
        row?: boolean;
      }
  );

interface SlotReferences {
  profileId: string | null;
  subagentProfileId: string | null;
}

interface PickedReferences extends SlotReferences {
  /* UNIT_BOUNDARY_DESCRIPTION: whether the last pick left the subagent slot to a profile (inherit), gave it values of its own, or cleared it for the harness to pick. Null is the stored slot, untouched. */
  subagentIntent: "inherit" | "own" | "clear" | null;
  ownSubagent: Record<string, string> | null;
}

type PickAction =
  | { kind: "primary" }
  | { kind: "subagent" }
  | { kind: "subagent-clear" }
  | { kind: "profile"; profile: ProfileWithUsage }
  | {
      kind: "references";
      references: {
        profileId?: string | null;
        platformSubagentProfileId?: string | null;
      };
      effective?: SessionPair;
    };

/* UNIT_BOUNDARY_DESCRIPTION: a profile that names no sub-agent keeps the native sub-agent settings it carries as its primary's own, so picking it into a pair never deletes them. */
function withProfileNativeSubagent(
  pair: SessionPair,
  profile: ProfileWithUsage,
): SessionPair {
  const native = Object.fromEntries(
    Object.entries(profile.settings).filter(([id]) =>
      isNativeSubagentSetting(id),
    ),
  );
  return Object.keys(native).length > 0
    ? { ...pair, settings: { ...(pair.settings ?? {}), ...native } }
    : pair;
}

function platformSubagentSettingsOf(
  pair: SessionPair,
): Record<string, string> | null {
  const settings = Object.fromEntries(
    Object.entries(pair.settings ?? {}).filter(([id]) =>
      isPlatformSubagentSetting(id),
    ),
  );
  return Object.keys(settings).length > 0 ? settings : null;
}

/* UNIT_BOUNDARY_DESCRIPTION: the effective pair the UI shows and sends: the primary's settings with the platform keys split off and the platform sub-agent slot beside them, own or lent, as the server's read-back answers it; a slot present means no native key, which only a run's payload derives, while no slot leaves the primary's own native keys as they are. */
function withEffectiveSubagent(
  pair: SessionPair,
  subagent: Record<string, string> | null,
): SessionPair {
  const { settings: _all, ...rest } = pair;
  const primarySettings = Object.fromEntries(
    Object.entries(pair.settings ?? {}).filter(
      ([id]) => !isPlatformSubagentSetting(id),
    ),
  );
  const settings = {
    ...(subagent === null
      ? primarySettings
      : Object.fromEntries(
          Object.entries(primarySettings).filter(
            ([id]) => !isNativeSubagentSetting(id),
          ),
        )),
    ...(subagent ?? {}),
  };
  return Object.keys(settings).length > 0 ? { ...rest, settings } : rest;
}

/* UNIT_BOUNDARY_DESCRIPTION: a stored pair with no sub-agent keys at all, which a profile reference or an inheriting slot stores: the profile lends the platform keys and the native mirror is derived. */
function withoutSubagentSettings(pair: SessionPair): SessionPair {
  const { settings: _all, ...rest } = pair;
  const settings = Object.fromEntries(
    Object.entries(pair.settings ?? {}).filter(
      ([id]) => !isPlatformSubagentSetting(id) && !isNativeSubagentSetting(id),
    ),
  );
  return Object.keys(settings).length > 0 ? { ...rest, settings } : rest;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness, model and session settings a new
 * session starts on, or, while the agent's harness list still loads, the pair
 * it expects with a loader in place of the body. Providers are not attached
 * or disconnected here: the Provider row's Manage providers entry leads to
 * the agent's Providers page.
 */
export function SessionPairPicker(props: Props) {
  const { agentId, open, onOpenChange, onConnectProviders } = props;
  const carried = props.pending ? [] : props.carried;
  const routed = props.pending ? false : (props.routed ?? false);
  const edit = props.pending ? undefined : props.edit;
  const target = props.pending ? undefined : props.target;
  const row = props.pending ? false : (props.row ?? false);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const picked = useStore((s) =>
    agentId ? (s.nextSessionPair[agentId] ?? null) : null,
  );
  const chosen = edit || target ? null : picked;
  const [fromProfile, setFromProfile] = usePickedProfile(agentId ?? "");
  const { data: profiles = [] } = useProfiles(agentId);
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
  const defaultHarness = props.pending
    ? (names[0] ?? "")
    : props.defaultHarness;
  const next = useNextSessionPair(agentId, names, defaultHarness);
  const saved = useSessionDefaults(edit || target ? null : agentId).data;
  const valueOnly = target?.valueOnly === true;
  /* UNIT_BOUNDARY_DESCRIPTION: the slots a pick is stored into, kept apart from the values it displays: a stored reference names a profile, and the effective pair is what the pick runs on. A destination that keeps only values never holds a primary reference. */
  const storedReferences: SlotReferences = target
    ? {
        profileId: valueOnly ? null : target.slots.profileId,
        subagentProfileId: target.slots.platformSubagentProfileId,
      }
    : {
        profileId: saved?.chatProfileId ?? null,
        subagentProfileId: saved?.platformSubagentProfileId ?? null,
      };
  /* UNIT_BOUNDARY_DESCRIPTION: the stored slots a draft was built on: a write the parent reflects, a failure, or another screen's change drops the draft so the picker never shows a reference the slots no longer hold. */
  const storedSignature = JSON.stringify([
    agentId,
    target ? target.label : "chat",
    target ? target.slots.profileId : (saved?.chatProfileId ?? null),
    storedReferences.subagentProfileId,
    target
      ? target.slots.platformSubagentSettings
      : (saved?.platformSubagentSettings ?? null),
    valueOnly ? (target?.slots.pair ?? null) : null,
  ]);
  const [draft, setDraft] = useState<{
    references: PickedReferences;
    basedOn: string;
  } | null>(null);
  const storedOwnSubagent = heldSubagent(
    target ? target.slots : saved,
    profiles,
  );
  const storedReferencesValue: PickedReferences = {
    ...storedReferences,
    subagentIntent: null,
    ownSubagent: storedOwnSubagent,
  };
  const references: PickedReferences = edit
    ? {
        profileId: null,
        subagentProfileId: null,
        subagentIntent: null,
        ownSubagent: null,
      }
    : draft?.basedOn === storedSignature
      ? draft.references
      : storedReferencesValue;
  /* UNIT_BOUNDARY_DESCRIPTION: a draft another agent, destination or stored write has left behind is discarded, so switching the mounted picker back never revives it. */
  useEffect(() => {
    if (draft && draft.basedOn !== storedSignature) setDraft(null);
  }, [draft, storedSignature]);
  const referenceProfile =
    profiles.find((p) => p.id === references.profileId) ?? null;
  const lentSubagent = referenceProfile
    ? lentSubagentOfProfile(referenceProfile)
    : null;
  const targetPrimary = referenceProfile
    ? {
        harness: referenceProfile.harness,
        provider: null,
        model: referenceProfile.model,
        settings: referenceProfile.settings,
      }
    : (target?.slots.pair ?? null);
  const basePair = target
    ? targetPrimary
    : (edit?.pair ??
      next ??
      (props.pending && names[0]
        ? { harness: names[0], provider: null, model: null }
        : null));
  /* UNIT_BOUNDARY_DESCRIPTION: what the body shows for the subagent: the stored slot's own values (or the next session's pick) unasked, the profile's lent values while it inherits, and nothing once the user clears it; the native mirror is derived by the shared rule. */
  const baseOwnSubagent = basePair
    ? platformSubagentSettingsOf(basePair)
    : null;
  const effectiveSubagent =
    references.subagentIntent === "clear"
      ? null
      : references.subagentIntent === "own"
        ? references.ownSubagent
        : references.subagentIntent === "inherit"
          ? lentSubagent
          : (references.ownSubagent ?? baseOwnSubagent ?? lentSubagent);
  const harness =
    (chosen && names.includes(chosen.harness) ? chosen.harness : null) ??
    basePair?.harness ??
    defaultHarness;
  const capability = carried.find((h) => h.name === harness);
  const catalogModels = useHarnessCatalogModels(
    agentId,
    routed ? harness : null,
    { unattached: true },
  );
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  const pair =
    basePair && !edit
      ? references.subagentIntent === "clear"
        ? withoutSubagentSettings(basePair)
        : withEffectiveSubagent(basePair, effectiveSubagent)
      : basePair;
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
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    pair?.harness === harness ? (pair.model ?? null) : null,
  );
  const settle = (written: void | Promise<boolean>) => {
    if (!written) return;
    void written.then((ok) => {
      if (!ok) setDraft(null);
    });
  };
  /* UNIT_BOUNDARY_DESCRIPTION: the last pick in any chat is what the next chat
   * starts on (D90), and a pick stores the slots from its references while the
   * effective pair, the lent subagent materialized, is what that chat runs on. */
  const choose = (
    chosenPair: SessionPair,
    action: PickAction = { kind: "primary" },
  ) => {
    if (edit) return edit.onChoose(chosenPair);
    const keepDraft = (nextReferences: PickedReferences) => {
      setDraft({ references: nextReferences, basedOn: storedSignature });
      return nextReferences;
    };
    if (action.kind === "references") {
      const nextReferences = keepDraft({
        ...references,
        ...(action.references.profileId !== undefined && {
          profileId: valueOnly ? null : action.references.profileId,
        }),
        ...(action.references.platformSubagentProfileId !== undefined && {
          subagentProfileId: action.references.platformSubagentProfileId,
          subagentIntent:
            action.references.platformSubagentProfileId === null
              ? "inherit"
              : null,
          ownSubagent: null,
        }),
      });
      const forwarded = {
        profileId: nextReferences.profileId,
        ...(action.references.platformSubagentProfileId !== undefined && {
          platformSubagentProfileId: nextReferences.subagentProfileId,
        }),
      };
      const display = action.effective ?? chosenPair;
      if (target)
        return settle(target.onChoose(chosenPair, forwarded, display));
      if (!agentId) return;
      setPair(agentId, display);
      if (routed && chosenPair.model !== null)
        settle(
          rememberSessionPair(
            agentId,
            chosenPair,
            "chat",
            undefined,
            forwarded,
            display,
          ),
        );
      return;
    }

    let nextReferences: PickedReferences;
    let effectivePair = chosenPair;
    let storagePair = chosenPair;
    if (action.kind === "profile") {
      const offered = lentSubagentOfProfile(action.profile);
      const cleaned = withoutSubagentSettings(chosenPair);
      const primary = offered
        ? cleaned
        : withProfileNativeSubagent(cleaned, action.profile);
      effectivePair = withEffectiveSubagent(primary, offered);
      if (valueOnly) {
        nextReferences = {
          profileId: null,
          subagentProfileId: null,
          subagentIntent: "own",
          ownSubagent: offered,
        };
        storagePair = effectivePair;
      } else {
        nextReferences = {
          profileId: action.profile.id,
          subagentProfileId: null,
          subagentIntent: "inherit",
          ownSubagent: null,
        };
        storagePair = withoutSubagentSettings(chosenPair);
      }
    } else if (action.kind === "subagent") {
      const own = platformSubagentSettingsOf(chosenPair);
      nextReferences = {
        ...references,
        subagentProfileId: null,
        subagentIntent: "own",
        ownSubagent: own,
      };
      effectivePair = withEffectiveSubagent(chosenPair, own);
      storagePair = effectivePair;
    } else if (action.kind === "subagent-clear") {
      nextReferences = {
        profileId: null,
        subagentProfileId: null,
        subagentIntent: "clear",
        ownSubagent: null,
      };
      storagePair = withoutSubagentSettings(chosenPair);
    } else if (references.subagentProfileId !== null) {
      nextReferences = { ...references, profileId: null };
      storagePair = withoutSubagentSettings(chosenPair);
    } else if (references.subagentIntent === "clear") {
      nextReferences = { ...references, profileId: null };
    } else {
      /* UNIT_BOUNDARY_DESCRIPTION: a primary change carries no subagent settings of its own, so it keeps the platform slot on screen; the native mirror follows the shared rule and only the stored pair's own native keys survive without one. */
      const preserved =
        platformSubagentSettingsOf(chosenPair) ?? effectiveSubagent;
      nextReferences = {
        profileId: null,
        subagentProfileId: null,
        subagentIntent: preserved === null ? "clear" : "own",
        ownSubagent: preserved,
      };
      effectivePair = withEffectiveSubagent(chosenPair, preserved);
      storagePair = effectivePair;
    }
    keepDraft(nextReferences);
    const forwarded = {
      profileId: nextReferences.profileId,
      platformSubagentProfileId: nextReferences.subagentProfileId,
    };
    if (target)
      return settle(target.onChoose(storagePair, forwarded, effectivePair));
    if (!agentId) return;
    setPair(agentId, effectivePair);
    /* UNIT_BOUNDARY_DESCRIPTION: a harness picked without a model waits for its model; the server keeps no chat default without one. */
    if (routed && effectivePair.model !== null)
      settle(
        rememberSessionPair(
          agentId,
          storagePair,
          "chat",
          undefined,
          forwarded,
          effectivePair,
        ),
      );
  };
  const withSettings = (next: SessionPair): SessionPair =>
    Object.keys(settings).length > 0 ? { ...next, settings } : next;
  /* UNIT_BOUNDARY_DESCRIPTION: a channel row and a schedule form name a profile, so their rows mark that one; a page keeps no reference, so it marks the profile its values match, as a chat's picker does. */
  const primary =
    target && !target.agentDefault
      ? referenceProfile
      : primaryProfileOf(pair, profiles, capability);
  const saveAs = useSaveAsProfile({
    agentId: agentId ?? null,
    pair,
    providerTemplate: providers.owned.find(
      (p) =>
        p.id ===
        (findModel(groups, pair?.model ?? null)?.group.connectionId ??
          pair?.provider),
    )?.templateId,
    subagent: subagentFor(
      pair,
      providers.owned.find(
        (p) =>
          p.id ===
          findModel(groups, subagentOf(pair)?.model ?? null)?.group
            .connectionId,
      )?.templateId,
    ),
    from: fromProfile,
    capability,
    onSaved: (profile) => {
      setFromProfile(profile);
      if (pair)
        choose(withoutSubagentSettings(pair), {
          kind: "references",
          references: {
            profileId: profile.id,
            platformSubagentProfileId: null,
          },
          effective: pair,
        });
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
  const manageProviders = () =>
    agentId
      ? navigateToSandboxHome(agentId, "providers")
      : onConnectProviders();
  /* UNIT_BOUNDARY_DESCRIPTION: a named profile in use reads first on the trigger, so the pick says where it came from. */
  const triggerLabel =
    !edit && !target && primary && pair?.model
      ? `${primary.name} · ${prettyModelLabel(pair.model) ?? pair.model}`
      : label;
  const agentDefault = target?.agentDefault;
  /* UNIT_BOUNDARY_DESCRIPTION: neither primary slot set is this pick following the agent's default. */
  const following =
    agentDefault !== undefined && referenceProfile === null && pair === null;
  const rowTitle =
    agentDefault && following
      ? "Use agent default"
      : (primary?.name ??
        (pair?.model
          ? (prettyModelLabel(pair.model) ?? pair.model)
          : "Choose a model"));
  /* UNIT_BOUNDARY_DESCRIPTION: one that follows the default names the whole default, model and provider together; a profile's row names its values under the profile's name, and a model of the page's own names the provider under the model. */
  const rowSubtitle =
    agentDefault && following
      ? agentDefault.detail
      : primary
        ? (label ?? "")
        : (findModel(groups, pair?.model ?? null)?.group.displayName ??
          provider?.name ??
          harnessName(pair?.harness ?? "") ??
          "");

  const pickProfile = (profile: ProfileWithUsage, connectionId?: string) => {
    setFromProfile(profile);
    const profileCapability = carried.find((h) => h.name === profile.harness);
    const explicitProvider =
      connectionId &&
      groups.some(
        (g) =>
          g.connectionId === connectionId &&
          g.models.some((m) => sameModel(m.name, profile.model)),
      )
        ? connectionId
        : undefined;
    const profileProvider =
      explicitProvider ??
      findModel(groups, profile.model)?.group.connectionId ??
      connectionId ??
      providers.granted.find((p) => p.templateId === profile.providerTemplate)
        ?.id ??
      null;
    const values = {
      ...profileValues(pair, profile, profileCapability),
      provider: profileProvider,
    };
    choose(values, { kind: "profile", profile });
  };

  return (
    <div className="flex min-w-0 items-center gap-3">
      {attachDialog.dialog}
      {saveAs.dialog}
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          {row ? (
            <SessionPairRowTrigger
              label={target?.label}
              harness={
                (agentDefault && following
                  ? agentDefault.harness
                  : pair?.harness) ?? defaultHarness
              }
              title={rowTitle}
              subtitle={rowSubtitle}
            />
          ) : (
            <SessionPairTrigger
              harness={pair?.harness}
              label={
                catalog &&
                (pair
                  ? triggerLabel
                  : (target?.placeholder ?? "Choose a harness and model"))
              }
            />
          )}
        </PopoverTrigger>
        <PopoverContent
          side={row ? "bottom" : "top"}
          align="start"
          aria-label={
            target?.label ??
            (edit
              ? "Profile harness and model"
              : "New session harness and model")
          }
          onInteractOutside={keepOpenWhileDialog}
          className={cn(
            "flex flex-col gap-2 p-1 text-sm",
            row ? "w-[420px]" : "w-[340px]",
          )}
        >
          {routed ? (
            <SessionModelPicker
              agentId={agentId}
              carried={carried}
              harnesses={names}
              pair={pair}
              defaultHarness={defaultHarness}
              profiles={edit ? undefined : profiles}
              selectedProfileId={primary?.id ?? null}
              {...(!edit && {
                onPickProfile: pickProfile,
                onEditProfile: () => navigateToSettings("providers"),
                onManageProfiles: () => navigateToSettings("providers"),
                onLeaveProfiles: () => {
                  if (primary) setFromProfile(primary);
                },
                saveAsProfile: saveAs.row,
              })}
              {...(agentDefault && {
                agentDefault: {
                  active: following,
                  pair: agentDefault.pair,
                  onActivate: () => {
                    setDraft(null);
                    agentDefault.onClear();
                  },
                  onDeactivate: () => {
                    if (agentDefault.pair)
                      choose(agentDefault.pair, {
                        kind: "references",
                        references: { profileId: null },
                      });
                    else
                      choose(
                        {
                          harness: defaultHarness,
                          provider: null,
                          model: null,
                        },
                        {
                          kind: "references",
                          references: { profileId: null },
                        },
                      );
                  },
                },
              })}
              onChoose={(next, intent) => choose(next, { kind: intent })}
              onManageProviders={manageProviders}
            />
          ) : (
            <OldRuntimePairs
              agentId={agentId}
              carried={carried}
              names={names}
              current={harness}
              sections={sections}
              attached={attached}
              pair={pair}
              pending={pending}
              harnessName={harnessName(harness)}
              onDisconnect={confirmDisconnect}
              onAttach={attach}
              onChoose={(name) =>
                choose({
                  harness: name,
                  provider:
                    providerOptions(
                      name,
                      views,
                      providers.granted,
                      providers.owned,
                    ).granted[0]?.id ?? null,
                  model: null,
                })
              }
              onChooseModel={(id, model) =>
                choose(withSettings({ harness, provider: id, model }))
              }
              settings={{
                agentId,
                carried,
                capability,
                model: pair?.model ?? null,
                settings,
                defaults,
                onChange: (changes) =>
                  pair &&
                  choose({
                    ...pair,
                    settings: applySettingChanges(settings, changes),
                  }),
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      {pair && !edit && !target && (
        <ToolApprovalPicker
          capability={capability}
          settings={settings}
          onChange={(changes) => {
            if (!agentId) return;
            setPair(agentId, {
              ...pair,
              settings: { ...settings, ...changes },
            });
          }}
        />
      )}
    </div>
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the subagent a profile saved here carries, its provider named by the Connection the model runs on; null is "Same as agent". */
function subagentFor(
  pair: SessionPair | null,
  providerTemplate: string | undefined,
): { providerTemplate: string; model: string } | null {
  const model = subagentOf(pair)?.model;
  return model && providerTemplate ? { providerTemplate, model } : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when
 * agents.runtimeFleet.outdated is empty on prod. The harnesses a pick can
 * land on, then each attached provider's models under its own heading, asked
 * per provider.
 */
function OldRuntimePairs({
  agentId,
  carried,
  names,
  current,
  sections,
  attached,
  pair,
  pending,
  harnessName,
  onDisconnect,
  onAttach,
  onChoose,
  onChooseModel,
  settings,
}: {
  agentId: string | null;
  carried: readonly HarnessCapability[];
  names: readonly string[];
  current: string;
  sections: readonly ProviderConnectionRef[];
  attached: (id: string) => boolean;
  pair: SessionPair | null;
  pending: boolean;
  harnessName: string | undefined;
  onDisconnect?: (name: string, id: string) => void;
  onAttach: (provider: { id: string }) => void;
  onChoose: (name: string) => void;
  onChooseModel: (id: string, model: string) => void;
  settings: {
    agentId: string | null;
    carried: readonly HarnessCapability[];
    capability: HarnessCapability | undefined;
    model: string | null;
    settings: Readonly<Record<string, string>>;
    defaults: Readonly<Record<string, string>>;
    onChange: (changes: Record<string, string>) => void;
  };
}) {
  return (
    <>
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
        {names.length > 0 && (
          <HarnessList names={names} current={current} onPick={onChoose} />
        )}
        <hr className="border-border" />
        {agentId && (
          <OldRuntimeProviderSections
            agentId={agentId}
            harness={current}
            carried={carried}
            sections={sections}
            attached={attached}
            pair={pair}
            pending={pending}
            harnessName={harnessName}
            onDisconnect={onDisconnect}
            onAttach={onAttach}
            onChoose={onChooseModel}
          />
        )}
      </div>
      {pair && settings.capability?.sessionSettings && (
        <div className="border-t border-border px-2 pt-2 empty:hidden">
          <SessionSettingsControls {...settings} />
        </div>
      )}
    </>
  );
}

function HarnessList({
  names,
  current,
  onPick,
}: {
  names: readonly string[];
  current: string;
  onPick: (name: string) => void;
}) {
  const { data: catalog } = useHarnessCatalog();
  return (
    <ul role="group" aria-label="Harness" className="flex flex-col">
      {harnessOptions(names, catalog?.harnesses ?? []).map((h) => (
        <li key={h.name} className="flex items-center">
          <button
            type="button"
            aria-pressed={h.name === current}
            onClick={() => onPick(h.name)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
          >
            <span className="text-muted-foreground">
              <HarnessIcons harnesses={[h.name]} size="xs" />
            </span>
            {h.displayName}
          </button>
        </li>
      ))}
    </ul>
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
  );
}
