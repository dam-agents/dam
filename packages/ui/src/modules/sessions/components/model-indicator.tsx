import type { HarnessCapability } from "agent-runtime-api";
import {
  aliasForProviderType,
  type DefaultKind,
  parseQualifiedModel,
  type ProviderPresetType,
} from "api-server-api";

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
import {
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import {
  modelGroups,
  sameSideGroups,
  sessionModelLabel,
} from "../lib/catalog-groups.js";
import {
  harnessDisplayName,
  modelProviderLabel,
} from "../lib/session-pair-options.js";
import { settingDefaults, settingsForModel } from "../lib/session-settings.js";
import { DefaultFollowState } from "./default-follow-state.js";
import { SessionModelList } from "./session-model-list.js";
import { SetAsDefault } from "./session-pair-picker.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

interface Props {
  agentId: string;
  kind: DefaultKind | null;
  follows?: DefaultKind | null;
  followsDefaults?: boolean;
  onFollowDefault: (afterNextDefaults: boolean) => void;
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
  follows,
  followsDefaults = false,
  onFollowDefault,
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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId, kind ?? "chat");
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

  return (
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
        {routed ? (
          <div
            aria-label="Models for this session"
            className="-mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto"
          >
            <SessionModelList
              agentId={agentId}
              groups={groups}
              harnessName={harnessName}
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
        <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground empty:hidden">
          {kind && routed && followsDefaults && (
            <DefaultFollowState
              kind={kind}
              follows={follows}
              harness={harness}
              model={model}
              target={remembered}
              onFollow={() => onFollowDefault(false)}
            />
          )}
          {kind && !(followsDefaults && follows === kind) && (
            <SetAsDefault
              agentId={agentId}
              kind={kind}
              pair={{
                harness,
                provider,
                model,
                settings: settingsForModel(capability, groups, model, {
                  ...defaults,
                  ...settings,
                }),
              }}
              defaults={defaults}
              remembered={remembered}
              {...(followsDefaults && { onSet: () => onFollowDefault(true) })}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
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
