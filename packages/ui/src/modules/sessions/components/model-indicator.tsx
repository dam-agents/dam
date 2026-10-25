import { ChevronLeft } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { ProfileWithUsage } from "api-server-api";
import {
  aliasForProviderType,
  type DefaultKind,
  parseQualifiedModel,
  type ProviderPresetType,
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
import {
  ProfileList,
  SaveAsProfileRow,
  SubagentSection,
} from "../../profiles/components/profile-list.js";
import { SaveAsProfile } from "../../profiles/components/save-as-profile.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
} from "../api/session-pair.js";
import { rememberSessionPair } from "../api/session-pair.js";
import {
  modelGroups,
  sameSideGroups,
  sessionModelLabel,
} from "../lib/catalog-groups.js";
import {
  harnessDisplayName,
  modelProviderLabel,
} from "../lib/session-pair-options.js";
import { settingDefaults } from "../lib/session-settings.js";
import { subagentProfileOf, withSubagent } from "../lib/subagent-choice.js";
import { SessionModelList } from "./session-model-list.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

interface Props {
  agentId: string;
  kind: DefaultKind | null;
  harness: string;
  provider: string | null;
  model: string | null;
  settings?: Readonly<Record<string, string>>;
  carried: readonly HarnessCapability[];
  routed?: boolean;
  turnRunning?: boolean;
  onChoose: (model: string) => void;
  onConfigure: (settings: Record<string, string>) => void;
  onNewSession: () => void;
}

export function ModelIndicator({
  agentId,
  kind,
  harness,
  provider,
  model,
  settings = {},
  carried,
  routed = false,
  turnRunning = false,
  onChoose,
  onConfigure,
  onNewSession,
}: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  /* UNIT_BOUNDARY_DESCRIPTION: the picker opens on the profiles, the same view a
   * new chat shows, so one place teaches the other. */
  const [custom, setCustom] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  /* UNIT_BOUNDARY_DESCRIPTION: the profile the session's pick came from, kept
   * while the user tunes it, so the save can offer to update that profile. */
  const [fromProfile, setFromProfile] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { data: profiles = [] } = useProfiles(agentId);
  /* UNIT_BOUNDARY_DESCRIPTION: a session keeps its harness, so it offers only
   * the profiles that run on it, and the slot's options and its current value
   * read the same list. */
  const sessionProfiles = profiles.filter((p) => p.harness === harness);
  const withSubagentSettings = (profile: ProfileWithUsage | null) => {
    const next = withSubagent(
      { harness, provider, model, ...(settings && { settings }) },
      profile,
      capability,
      groups.flatMap((g) => g.models.map((m) => ({ name: m.name }))),
    );
    const keys = [
      "platformSubagent.harness",
      "platformSubagent.model",
      "subagentModel",
      "subagentEffort",
    ];
    return Object.fromEntries(
      keys.map((id) => [id, next.settings?.[id] ?? ""]),
    );
  };
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
  const groups = routed
    ? modelGroups(catalogModels.data, catalogModels.granted)
    : [];
  /* UNIT_BOUNDARY_DESCRIPTION: the values the view reads — what "Custom
   * selection" costs and how a repair attaches a provider — derived from the
   * pair and the connections, never kept in state. */
  const catalogCounts = {
    harnesses: carried.length,
    models: groups.reduce((total, group) => total + group.models.length, 0),
  };
  const attachAndPick = (profile: ProfileWithUsage) => {
    const connection = owned.find(
      (p) => p.templateId === profile.providerTemplate,
    );
    if (!connection) {
      navigateToSettings("providers");
      return;
    }
    void grant(connection.id).then((ok) => {
      if (ok) onChoose(profile.model);
    });
  };
  /* UNIT_BOUNDARY_DESCRIPTION: the subagent section writes the slot's keys and
   * the native ones through the ordinary configure call, empty string clearing
   * a key, so the session and its next saved default agree. */
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
    ? (sessionModelLabel(groups, model) ?? "Choose a model")
    : (models.find((m) => m.value === model)?.name ?? model);
  const unlisted =
    !routed &&
    model !== null &&
    !!data?.availableModels?.length &&
    !data.availableModels.some((m) => m.value === model);

  const savingAsProfile =
    savingProfile && activeProvider?.templateId !== undefined ? (
      <SaveAsProfile
        agentId={agentId}
        pair={{ harness, provider, model, ...(settings && { settings }) }}
        providerTemplate={activeProvider.templateId}
        profile={fromProfile}
        onClose={() => setSavingProfile(false)}
        onSaved={() => setSavingProfile(false)}
      />
    ) : null;

  return (
    <>
      {savingAsProfile}
      <Popover>
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
          {routed && !custom && sessionProfiles.length > 0 ? (
            <div className="flex flex-col gap-1">
              <ProfileList
                /* UNIT_BOUNDARY_DESCRIPTION: a session keeps its harness, so it
                 * offers only the profiles that run on it; another harness needs a
                 * new session, which the profile list cannot show. */
                profiles={sessionProfiles}
                current={{
                  harness,
                  provider,
                  model,
                  ...(settings && { settings }),
                }}
                onPick={(profile) => {
                  /* UNIT_BOUNDARY_DESCRIPTION: a pick applies the model and the
                   * settings the profile holds, and saves those same values with
                   * the reference, so the next chat starts on what this one got.
                   * Only a chat session names a profile; a channel or scheduled
                   * session keeps its own on the row or the spec. */
                  setFromProfile({ id: profile.id, name: profile.name });
                  onChoose(profile.model);
                  /* UNIT_BOUNDARY_DESCRIPTION: the session takes exactly what
                   * the profile holds, so a setting the profile does not name is
                   * cleared rather than left from the previous pick. */
                  /* UNIT_BOUNDARY_DESCRIPTION: the profile's own settings
                   * replace the session's, and the subagent choice it did not
                   * name is carried over through the same rule, so a primary
                   * pick never clears the subagent one. */
                  onConfigure({
                    ...Object.fromEntries(
                      Object.keys(settings)
                        .filter((id) => !id.startsWith("platformSubagent."))
                        .map((id) => [id, ""]),
                    ),
                    ...profile.settings,
                    ...withSubagentSettings(
                      subagentProfileOf(
                        {
                          harness,
                          provider,
                          model,
                          ...(settings && { settings }),
                        },
                        profiles,
                      ),
                    ),
                  });
                  rememberSessionPair(
                    agentId,
                    {
                      harness,
                      provider,
                      model: profile.model,
                      ...(Object.keys(profile.settings).length > 0 && {
                        settings: profile.settings,
                      }),
                    },
                    "chat",
                    undefined,
                    kind === "chat" ? { profileId: profile.id } : undefined,
                  );
                }}
                counts={catalogCounts}
                onAttach={attachAndPick}
                onCustom={() => setCustom(true)}
                onManage={() => navigateToSettings("providers")}
              />
              <SubagentSection
                /* UNIT_BOUNDARY_DESCRIPTION: a platform sub-agent is another
                 * agent, so this section offers every profile; the native rule
                 * decides what the session's own harness can take from it. */
                profiles={profiles}
                selectedId={
                  subagentProfileOf(
                    {
                      harness,
                      provider,
                      model,
                      ...(settings && { settings }),
                    },
                    /* UNIT_BOUNDARY_DESCRIPTION: the section offers every
                     * profile, so the selection is looked up in the same list. */
                    profiles,
                  )?.id ?? null
                }
                onAgentPicks={() => onConfigure(withSubagentSettings(null))}
                onPick={(profile) => onConfigure(withSubagentSettings(profile))}
                onAttach={attachAndPick}
                onManage={() => navigateToSettings("providers")}
              />
            </div>
          ) : routed ? (
            <div
              aria-label="Models for this session"
              className="-mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {sessionProfiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCustom(false)}
                  className="flex items-center gap-1 rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft size={14} aria-hidden />
                  Use a profile
                </button>
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
                  navigateToSandboxHome(agentId, "providers")
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
          {routed && custom && model !== null && (
            <div className="border-t border-border pt-2">
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
          {capability?.sessionSettings && (
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
    </>
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
