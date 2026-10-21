import { routesSessionPairs } from "agent-runtime-api";
import type { DefaultKind, SessionPair } from "api-server-api";
import { useState } from "react";

import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  rememberSessionPair,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
} from "../../sessions/api/session-pair.js";
import { AwakeModelsGate } from "../../sessions/components/awake-models-gate.js";
import { OptionPicker } from "../../sessions/components/model-settings-panel.js";
import { OptionField } from "../../sessions/components/option-field.js";
import { SessionSettingsControls } from "../../sessions/components/session-settings-controls.js";
import {
  findModel,
  modelGroups,
  sameModel,
  sameSideGroups,
} from "../../sessions/lib/catalog-groups.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
} from "../../sessions/lib/session-pair-options.js";
import {
  applySettingChanges,
  settingDefaults,
  settingsForModel,
} from "../../sessions/lib/session-settings.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness, provider, model and settings of one
 * of the agent's defaults, laid out like the session picker, Subagents block
 * included. Each pick saves the default of its kind at once. A harness picked
 * on a routed runtime waits for its model, since a default is saved only with
 * one.
 */
export function DefaultPairEditor({
  agentId,
  kind,
  current,
}: {
  agentId: string;
  kind: DefaultKind;
  current: SessionPair | null;
}) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const { data: catalog } = useHarnessCatalog();
  const { granted } = useProviderConnections(agentId);
  const carried = status?.harnesses ?? [];
  const views = catalog?.harnesses ?? [];
  const fitting = fittingProviders(views, granted);
  const harnesses = harnessOptions(
    carried.map((h) => h.name),
    views,
  ).filter((h) => fitting(h.name).length > 0);
  const routed = status?.modelRouter ?? false;
  const [draftHarness, setDraftHarness] = useState<string | null>(null);
  const saved = nextPair(
    null,
    current,
    harnesses.map((h) => h.name),
    fitting,
    status?.defaultHarness,
  );
  const pair =
    routed && draftHarness !== null && draftHarness !== saved?.harness
      ? { harness: draftHarness, provider: null, model: null }
      : saved;
  const { data: models } = useProviderModels(
    routed ? null : agentId,
    pair?.harness ?? null,
    pair?.provider ?? null,
  );
  const { data: catalogModels } = useHarnessCatalogModels(
    routed ? agentId : null,
    pair?.harness ?? null,
  );
  const configured = useHarnessConfigured(agentId, pair?.harness ?? null);
  if (!pair || !routesSessionPairs(carried)) return null;
  const groups = modelGroups(catalogModels);
  const capability = carried.find((h) => h.name === pair.harness);
  const settings = pair.settings ?? {};

  const save = (next: SessionPair) => {
    const kept =
      pair.harness === next.harness && next.settings
        ? settingsForModel(capability, groups, next.model, next.settings)
        : {};
    const bare = {
      harness: next.harness,
      provider: next.provider,
      model: next.model,
    };
    rememberSessionPair(
      agentId,
      Object.keys(kept).length > 0 ? { ...bare, settings: kept } : bare,
      kind,
    );
  };
  const modelChoices = routed
    ? groups.flatMap((g) =>
        g.models.map((m) => ({
          value: m.name,
          name: `${m.upstreamId} · ${g.displayName}`,
        })),
      )
    : ((models?.availableModels === null
        ? capability?.harnessConfigCatalog?.options.find(
            (o) => o.category === "model",
          )?.choices
        : models?.availableModels) ?? []);
  const providerOfModel = (model: string | null): string | null =>
    groups.find((g) => g.models.some((m) => sameModel(m.name, model)))
      ?.connectionId ?? pair.provider;

  return (
    <>
      <OptionField title="Harness">
        <OptionPicker
          title="Harness"
          choices={harnesses.map((h) => ({ id: h.name, name: h.displayName }))}
          value={pair.harness}
          onSelect={(harness) => {
            if (!harness) return;
            if (routed) setDraftHarness(harness);
            else save({ harness, provider: fitting(harness)[0]!, model: null });
          }}
        />
      </OptionField>
      {!routed && (
        <OptionField title="Provider">
          <OptionPicker
            title="Provider"
            choices={granted
              .filter((p) => fitting(pair.harness).includes(p.id))
              .map((p) => ({ id: p.id, name: p.name }))}
            value={pair.provider}
            onSelect={(provider) =>
              provider && save({ harness: pair.harness, provider, model: null })
            }
          />
        </OptionField>
      )}
      <OptionField title="Model">
        <AwakeModelsGate agentId={agentId}>
          <OptionPicker
            title="Model"
            choices={modelChoices.map((m) => ({ id: m.value, name: m.name }))}
            value={
              routed
                ? (findModel(groups, pair.model)?.model.name ?? pair.model)
                : pair.model
            }
            clearable={!routed}
            {...(routed && { placeholder: "Not set" })}
            onSelect={(model) => {
              if (routed && model === null) return;
              save({ ...pair, provider: providerOfModel(model), model });
              setDraftHarness(null);
            }}
          />
        </AwakeModelsGate>
      </OptionField>
      {pair.model !== null && (
        <OptionField title="Settings">
          <SessionSettingsControls
            agentId={agentId}
            carried={carried}
            capability={capability}
            model={pair.model}
            settings={settings}
            defaults={settingDefaults(capability, configured, pair.model)}
            modelChoices={sameSideGroups(groups, pair.model).flatMap((g) =>
              g.models.map((m) => ({
                value: m.name,
                name: `${m.upstreamId} · ${g.displayName}`,
              })),
            )}
            onChange={(changes) =>
              save({
                ...pair,
                settings: applySettingChanges(settings, changes),
              })
            }
          />
        </OptionField>
      )}
    </>
  );
}
