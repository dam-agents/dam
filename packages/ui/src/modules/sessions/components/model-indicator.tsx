import { ChevronLeft } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import {
  aliasForProviderType,
  parseQualifiedModel,
  type ProviderPresetType,
  type SessionPair,
} from "api-server-api";
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

import { useStore } from "../../../store.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { ModelConfiguration } from "../../profiles/components/profile-list.js";
import { useSaveAsProfile } from "../../profiles/components/save-as-profile.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
} from "../api/session-pair.js";
import {
  findModel,
  modelGroups,
  sameSideGroups,
} from "../lib/catalog-groups.js";
import {
  harnessDisplayName,
  modelProviderLabel,
  providerOptions,
} from "../lib/session-pair-options.js";
import {
  applySettingChanges,
  pairSummary,
  settingDefaults,
} from "../lib/session-settings.js";
import {
  isProfileSetting,
  pickProfile,
  primaryProfileOf,
  SUBAGENT_KEYS,
  subagentOf,
  subagentProfileOf,
  withSubagent,
} from "../lib/subagent-choice.js";
import { PlatformSubagentSettings } from "./platform-subagent-settings.js";
import { SessionModelList } from "./session-model-list.js";
import { PairSummary, SessionPairTrigger } from "./session-pair-trigger.js";
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
  const showConfirm = useStore((s) => s.showConfirm);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
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
    routed ? agentId : null,
    harness,
  );
  const fitting = providerOptions(
    harness,
    catalog?.harnesses ?? [],
    granted,
    owned,
  ).granted;
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted).filter(
        (g) => !catalog || fitting.some((p) => p.id === g.connectionId),
      )
    : [];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"profiles" | "custom" | "subagent">(
    "profiles",
  );
  /* UNIT_BOUNDARY_DESCRIPTION: the profile this session's pick came from, so Update writes back to it; another session's pick never carries over. */
  const [origin, setOrigin] = useState<{
    sessionId: string | null;
    profile: { id: string; name: string };
  } | null>(null);
  const fromProfile =
    origin && origin.sessionId === sessionId ? origin.profile : null;
  const setFromProfile = (profile: { id: string; name: string }) =>
    setOrigin({ sessionId, profile });
  const { data: profiles = [] } = useProfiles(agentId);
  /* UNIT_BOUNDARY_DESCRIPTION: a session keeps its harness, so its primary model is offered only the profiles that run on it. */
  const sessionProfiles = profiles.filter((p) => p.harness === harness);
  const current: SessionPair = { harness, provider, model, settings };
  const listed = groups.flatMap((g) => g.models.map((m) => ({ name: m.name })));
  const primary = primaryProfileOf(current, sessionProfiles, capability);
  const slot = subagentProfileOf(current, profiles);
  const customSlot = subagentOf(current);
  const subagentChanges = (next: SessionPair) =>
    Object.fromEntries(SUBAGENT_KEYS.map((k) => [k, next.settings?.[k] ?? ""]));
  const saveAs = useSaveAsProfile({
    agentId,
    pair: current,
    providerTemplate: activeProvider?.templateId,
    from: fromProfile,
    capability,
    onSaved: setFromProfile,
  });
  const showProfiles =
    routed && view === "profiles" && sessionProfiles.length > 0;
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
        provider:
          findModel(groups, model)?.group.displayName ?? activeProvider?.name,
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
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setView("profiles");
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <SessionPairTrigger
            testId="session-model-picker"
            harness={harness}
            label={
              harnessName &&
              [
                routed
                  ? modelName
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
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[340px] flex-col gap-3 overflow-y-auto text-sm"
        >
          <div className="flex items-center gap-2 px-1">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className="text-muted-foreground">
                  <HarnessIcons harnesses={[harness]} size="xs" />
                </span>
                <span className="truncate">{harnessName ?? harness}</span>
              </div>
              {!routed && activeProvider && (
                <h3 className={labelVariants()}>{activeProvider.name}</h3>
              )}
              {routed && turnRunning && (
                <p className="text-xs text-muted-foreground">
                  A model picked now applies to the next message.
                </p>
              )}
            </div>
            {!routed && (
              <PopoverClose asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void showConfirm(
                      <>
                        <p>
                          To use a different harness or model provider, start a
                          new session.
                        </p>
                        <p className="mt-2">
                          If you need to move over context from the current
                          session, ask the agent to save it to a file.
                        </p>
                      </>,
                      "Change harness or provider",
                      { confirmLabel: "New session" },
                    ).then((ok) => ok && onNewSession())
                  }
                >
                  Change
                </Button>
              </PopoverClose>
            )}
          </div>
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
          {showProfiles ? (
            <ModelConfiguration
              agentId={agentId}
              profiles={sessionProfiles}
              customHint={harnessName ?? harness}
              primary={{
                selectedId: primary?.id ?? null,
                custom: primary ? null : (
                  <PairSummary harness={harness} label={modelName ?? ""} />
                ),
                onPick: (profile) => {
                  setOpen(false);
                  setFromProfile(profile);
                  onChoose(profile.model, {
                    ...Object.fromEntries(
                      Object.keys(settings)
                        .filter((k) => isProfileSetting(k, capability))
                        .map((k) => [k, ""]),
                    ),
                    ...pickProfile(current, profile, capability, listed)
                      .settings,
                  });
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
                  onConfigure(
                    subagentChanges(
                      withSubagent(current, profile, capability, listed),
                    ),
                  ),
                onCustom: () => setView("subagent"),
              }}
              onAgentPicks={() =>
                onConfigure(
                  subagentChanges(
                    withSubagent(current, null, capability, listed),
                  ),
                )
              }
            />
          ) : view === "subagent" ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-xs">
              <BackToProfiles onClick={() => setView("profiles")} />
              <PlatformSubagentSettings
                agentId={agentId}
                carried={carried}
                settings={settings}
                idPrefix="session"
                disabled={false}
                onChange={(changes) => {
                  const next = {
                    ...current,
                    settings: applySettingChanges(settings, changes),
                  };
                  onConfigure({
                    ...changes,
                    ...subagentChanges(
                      withSubagent(next, subagentOf(next), capability, listed),
                    ),
                  });
                }}
              />
            </div>
          ) : routed ? (
            <div
              aria-label="Models for this session"
              className="-mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {sessionProfiles.length > 0 && (
                <BackToProfiles onClick={() => setView("profiles")} />
              )}
              <SessionModelList
                agentId={agentId}
                groups={groups}
                current={model}
                loading={catalogModels.isLoading}
                waiting={catalogModels.waiting}
                failed={catalogModels.isError}
                onRetry={() => void catalogModels.refetch()}
                onChoose={(name) => onChoose(name)}
                onManageProviders={() =>
                  navigateToSandboxHome(agentId, "models")
                }
              />
            </div>
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
          {routed && view === "custom" && saveAs.row && (
            <div className="border-t border-border pt-2">{saveAs.row}</div>
          )}
          {!showProfiles &&
            view !== "subagent" &&
            capability?.sessionSettings && (
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

function BackToProfiles({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-2 flex items-center gap-1 rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronLeft size={14} aria-hidden />
      Use a profile
    </button>
  );
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
            <PopoverClose asChild>
              <button
                type="button"
                aria-current={choice.value === model ? "true" : undefined}
                onClick={() => onChoose(choice.value)}
                className="w-full truncate rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground"
              >
                {choice.name}
              </button>
            </PopoverClose>
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
