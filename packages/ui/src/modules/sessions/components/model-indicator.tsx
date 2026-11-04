import type { HarnessCapability } from "agent-runtime-api";
import {
  effectiveSubagentSettings,
  isPlatformSubagentSetting,
} from "agent-runtime-api";
import {
  aliasForProviderType,
  parseQualifiedModel,
  type ProviderPresetType,
  type SessionPair,
} from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { labelVariants } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useProfiles } from "../../profiles/api/queries.js";
import {
  usePickedProfile,
  useSaveAsProfile,
} from "../../profiles/components/save-as-profile.js";
import { shortProviderName } from "../../providers/lib/provider-rows.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
} from "../api/session-pair.js";
import { keepOpenWhileDialog } from "../hooks/use-connect-on-pick.js";
import {
  findModel,
  modelGroups,
  sameModel,
  sameSideGroups,
} from "../lib/catalog-groups.js";
import { prettyModelLabel } from "../lib/model-families.js";
import {
  harnessDisplayName,
  modelProviderLabel,
  providerOfModel,
} from "../lib/session-pair-options.js";
import { pairSummary, settingDefaults } from "../lib/session-settings.js";
import {
  pickProfile as profileValues,
  primaryProfileOf,
  settingChanges,
  subagentOf,
} from "../lib/subagent-choice.js";
import { SessionModelPicker } from "./session-model-picker.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";
import { ToolApprovalPicker } from "./tool-approval-picker.js";

interface Props {
  agentId: string;
  sessionId: string | null;
  harness: string;
  provider: string | null;
  model: string | null;
  settings?: Readonly<Record<string, string>>;
  carried: readonly HarnessCapability[];
  routed?: boolean;
  turnRunning?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: a model, and the settings changes that come with it when a profile is picked. */
  onChoose: (model: string, settings?: Record<string, string>) => void;
  onConfigure: (settings: Record<string, string>) => void;
  /** UNIT_BOUNDARY_DESCRIPTION: a tool-approval pick, which configures this session and is saved nowhere else. */
  onToolApproval: (settings: Record<string, string>) => void;
  onNewSession: () => void;
}

export function ModelIndicator({
  agentId,
  sessionId,
  harness,
  provider,
  model,
  settings = {},
  carried,
  routed = false,
  turnRunning = false,
  onChoose,
  onConfigure,
  onToolApproval,
  onNewSession,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data: catalog } = useHarnessCatalog();
  const capability = carried.find((h) => h.name === harness);
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    model,
  );
  const { granted, owned, loaded } = useProviderConnections(agentId);
  const { grant, pending } = useGrantProvider(agentId);
  const activeProvider = granted.find((p) => p.id === provider);
  const alias = routed
    ? (parseQualifiedModel(model, { claudePrefix: true })?.alias ?? null)
    : null;
  const byAlias = (p: { type: ProviderPresetType }) =>
    aliasForProviderType(p.type) === alias;
  const removed =
    loaded &&
    (routed
      ? alias !== null && !granted.some(byAlias)
      : provider !== null && !activeProvider);
  const removedConnection = removed
    ? routed
      ? owned.find(byAlias)
      : owned.find((p) => p.id === provider)
    : undefined;
  const { data, isLoading, isError, operable } = useProviderModels(
    removed || routed ? null : agentId,
    harness,
    provider,
  );
  const catalogModels = useHarnessCatalogModels(
    agentId,
    routed ? harness : null,
    { unattached: true },
  );
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  const [open, setOpen] = useState(false);
  const [fromProfile, setFromProfile] = usePickedProfile(
    `${agentId}/${sessionId ?? ""}`,
  );
  const { data: profiles = [] } = useProfiles(agentId);
  /* UNIT_BOUNDARY_DESCRIPTION: a session keeps its harness, so its primary model is offered only the profiles that run on it. */
  const sessionProfiles = profiles.filter((p) => p.harness === harness);
  const current: SessionPair = { harness, provider, model, settings };
  const primary = primaryProfileOf(current, sessionProfiles, capability);
  const saveAs = useSaveAsProfile({
    agentId,
    pair: current,
    providerTemplate: owned.find(
      (p) =>
        p.id === (findModel(groups, model)?.group.connectionId ?? provider),
    )?.templateId,
    subagent: subagentFor(
      current,
      owned.find(
        (p) =>
          p.id ===
          findModel(groups, subagentOf(current)?.model ?? null)?.group
            .connectionId,
      )?.templateId,
    ),
    from: fromProfile,
    capability,
    onSaved: setFromProfile,
  });
  /* UNIT_BOUNDARY_DESCRIPTION: the session's full settings with the one rule settled against its own pair: the platform slot the pair carries and the native keys the harness's own subagents take where the sub-agent model runs on the session's provider. The UI holds the authoritative pair and settings, so it settles a configure patch itself instead of relying on the relay's per-connection state. */
  const settledSettings = (next: SessionPair) => {
    const all = next.settings ?? {};
    if (!routed) return all;
    const slot = Object.fromEntries(
      Object.entries(all).filter(([id]) => isPlatformSubagentSetting(id)),
    );
    if (Object.keys(slot).length === 0) return all;
    const primary = Object.fromEntries(
      Object.entries(all).filter(([id]) => !isPlatformSubagentSetting(id)),
    );
    /* UNIT_BOUNDARY_DESCRIPTION: the session's effective provider is the model's owner-catalog group; a reported provider is trusted only while its own listing offers that model, since a pinned model keeps the old provider in session metadata. */
    const offeredBy = (connectionId: string | null | undefined) =>
      connectionId != null &&
      (groups
        .find((g) => g.connectionId === connectionId)
        ?.models.some((m) => sameModel(m.name, next.model ?? "")) ??
        false);
    const supplied = next.provider ?? provider;
    /* UNIT_BOUNDARY_DESCRIPTION: an unlisted primary model (the catalog is down or the model is gone) still names its provider by its qualified alias among the agent's Connections; without a match compatibility is unknown, so no native key is derived rather than trusting the stale field. */
    const sessionProvider = offeredBy(supplied)
      ? supplied
      : (findModel(groups, next.model ?? null)?.group.connectionId ??
        providerOfModel(next.model ?? null, granted)?.id ??
        null);
    return effectiveSubagentSettings(capability, primary, slot, (name) =>
      groups.some(
        (g) =>
          g.connectionId === sessionProvider &&
          g.models.some((m) => sameModel(m.name, name)),
      ),
    );
  };
  const applyPair = (next: SessionPair) => {
    const changes = settingChanges(settings, settledSettings(next));
    if (next.model !== null && next.model !== model)
      onChoose(next.model, changes);
    else if (Object.keys(changes).length > 0) onConfigure(changes);
  };
  const pickProfile = (profile: (typeof sessionProfiles)[number]) => {
    setFromProfile(profile);
    applyPair(
      profileValues(
        current,
        profile,
        carried.find((h) => h.name === profile.harness),
      ),
    );
  };
  const harnessName = harnessDisplayName(harness, catalog?.harnesses);
  const models = removed
    ? []
    : data?.availableModels === null
      ? (carried
          .find((h) => h.name === harness)
          ?.harnessConfigCatalog?.options.find((o) => o.category === "model")
          ?.choices ?? [])
      : (data?.availableModels ?? []);
  const modelName = routed
    ? pairSummary(model, {
        settings,
        defaults,
        capability,
        provider: (() => {
          const connection = owned.find(
            (p) =>
              p.id ===
              (findModel(groups, model)?.group.connectionId ?? provider),
          );
          return connection
            ? shortProviderName(connection)
            : activeProvider?.name;
        })(),
      })
    : (models.find((m) => m.value === model)?.name ?? model);
  const unlisted =
    !routed &&
    model !== null &&
    !!data?.availableModels?.length &&
    !data.availableModels.some((m) => m.value === model);

  return (
    <div className="flex min-w-0 items-center gap-3">
      {saveAs.dialog}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SessionPairTrigger
            testId="session-model-picker"
            harness={harness}
            label={
              harnessName &&
              [
                routed
                  ? primary && model
                    ? `${primary.name} · ${prettyModelLabel(model) ?? model}`
                    : modelName
                  : modelProviderLabel(
                      modelName,
                      activeProvider?.name,
                      harnessName,
                    ),
                removed ? "Provider removed" : null,
                unlisted ? "Model not offered" : null,
              ]
                .filter(Boolean)
                .join(" · ")
            }
          />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label="Session harness and model"
          collisionPadding={8}
          onInteractOutside={keepOpenWhileDialog}
          tail={false}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[368px] flex-col overflow-y-auto text-sm shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
        >
          {!routed && activeProvider && (
            <h3 className={cn("px-1", labelVariants())}>
              {activeProvider.name}
            </h3>
          )}
          {routed && removed && (
            <section
              aria-label="Provider removed"
              className="flex flex-col gap-1 px-1 text-muted-foreground"
            >
              <p>
                The provider this session ran on was removed. Pick another
                provider's model below
                {removedConnection ? ", or attach it again." : "."}
              </p>
              {removedConnection && (
                <Button
                  variant="link"
                  size="inline"
                  className="self-start"
                  disabled={pending}
                  onClick={() => void grant(removedConnection.id)}
                >
                  Attach {removedConnection.name} again
                </Button>
              )}
            </section>
          )}
          {routed ? (
            <SessionModelPicker
              agentId={agentId}
              carried={carried}
              harnesses={[harness]}
              pair={current}
              defaultHarness={harness}
              locked={{ onNewSession }}
              {...(turnRunning && {
                note: "A model picked now applies to the next message.",
              })}
              profiles={profiles}
              profileHarness={harness}
              selectedProfileId={primary?.id ?? null}
              onPickProfile={pickProfile}
              onManageProfiles={() => navigateToSettings("profiles")}
              onEditProfile={(profile) =>
                navigateToSettings("profiles", { profileId: profile.id })
              }
              onLeaveProfiles={() => {
                if (primary) setFromProfile(primary);
              }}
              saveAsProfile={saveAs.row}
              onChoose={applyPair}
              onManageProviders={() =>
                navigateToSandboxHome(agentId, "providers")
              }
            />
          ) : (
            <OldRuntimeModels
              providerName={activeProvider?.name}
              models={models}
              model={model}
              removed={removed}
              operable={operable}
              loading={isLoading}
              failed={isError || data?.availableModels === undefined}
              onChoose={onChoose}
            />
          )}
          {!routed && capability?.sessionSettings && (
            <div className="border-t border-border pt-2 empty:hidden">
              <SessionSettingsControls
                agentId={agentId}
                carried={carried}
                capability={capability}
                model={model}
                settings={settings}
                defaults={defaults}
                modelChoices={sameSideGroups(groups, model).flatMap((g) =>
                  g.models.map((m) => ({
                    value: m.name,
                    name: `${m.upstreamId} · ${g.displayName}`,
                  })),
                )}
                onChange={onConfigure}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
      <ToolApprovalPicker
        capability={capability}
        settings={settings}
        onChange={onToolApproval}
      />
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
 * agents.runtimeFleet.outdated is empty on prod. A running session lists only
 * the active provider's models; another provider needs a new session.
 */
function OldRuntimeModels({
  providerName,
  models,
  model,
  removed,
  operable,
  loading,
  failed,
  onChoose,
}: {
  providerName: string | undefined;
  models: readonly { value: string; name: string }[];
  model: string | null;
  removed: boolean;
  operable: boolean;
  loading: boolean;
  failed: boolean;
  onChoose: (model: string) => void;
}) {
  return (
    <section aria-label={providerName ?? "Active provider"}>
      <ul
        aria-label="Models for this session"
        className="-mx-1 max-h-56 overflow-y-auto"
      >
        {models.map((choice) => (
          <li key={choice.value}>
            <button
              type="button"
              aria-current={choice.value === model ? "true" : undefined}
              onClick={() => onChoose(choice.value)}
              className="w-full truncate rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground"
            >
              {choice.name}
            </button>
          </li>
        ))}
        {models.length === 0 && (
          <li className="px-1 py-1 text-muted-foreground">
            {removed
              ? "Provider removed."
              : !operable
                ? "Start the agent to list models."
                : loading
                  ? "Loading models…"
                  : failed
                    ? "Couldn't load this provider's models."
                    : "No models available."}
          </li>
        )}
      </ul>
    </section>
  );
}
