import { routesSessionPairs } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useHarnessCatalogModels,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../../sessions/api/session-pair.js";
import { OptionPicker } from "../../sessions/components/model-settings-panel.js";
import { OptionField } from "../../sessions/components/option-field.js";
import { settingsForModel } from "../../sessions/components/session-settings-controls.js";
import {
  findModel,
  modelGroups,
  sameModel,
} from "../../sessions/lib/catalog-groups.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
} from "../../sessions/lib/session-pair-options.js";
import { ConnectionSpendLimit } from "../../spend/components/connection-spend-limit.js";
import { RootDriverSpendNote } from "../../spend/components/root-driver-spend-note.js";

export function SandboxProvidersSection({ agentId }: { agentId: string }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { owned, granted, loaded } = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);
  const root = useRootDriver(agentId);

  return (
    <div className="flex flex-col gap-3">
      {root && <RootDriverSpendNote root={root} />}
      {loaded && owned.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No providers connected yet.
        </p>
      )}
      {owned.map((p) => {
        const attached = granted.some((g) => g.id === p.id);
        return (
          <Card key={p.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <CardIcon provider={p.type} />
              <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                {p.name}
              </span>
              <Switch
                checked={attached}
                disabled={pending}
                label={`Use ${p.name} in this agent`}
                onCheckedChange={(on) =>
                  on
                    ? void grant(p.id)
                    : void showConfirm(
                        <p>
                          Sessions running on <strong>{p.name}</strong> stop
                          until it is attached again. Schedules and channels
                          that use it move to another provider.
                        </p>,
                        `Disconnect ${p.name} from this agent?`,
                        { kind: "destructive", confirmLabel: "Disconnect" },
                      ).then((ok) => ok && revoke(p.id))
                }
              />
            </div>
            {attached && root === null && p.templateId && (
              <ConnectionSpendLimit
                agentId={agentId}
                connectionId={p.id}
                templateId={p.templateId}
              />
            )}
          </Card>
        );
      })}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => navigateToSettings("providers")}
      >
        Manage providers
      </Button>
      <DefaultPairPicker agentId={agentId} />
    </div>
  );
}

function DefaultPairPicker({ agentId }: { agentId: string }) {
  const { data: status } = useHarnessConfigStatus(agentId);
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const { granted } = useProviderConnections(agentId);
  const carried = status?.harnesses ?? [];
  const views = catalog?.harnesses ?? [];
  const fitting = fittingProviders(views, granted);
  const harnesses = harnessOptions(
    carried.map((h) => h.name),
    views,
  ).filter((h) => fitting(h.name).length > 0);
  const pair = nextPair(
    null,
    remembered ?? null,
    harnesses.map((h) => h.name),
    fitting,
    status?.defaultHarness,
  );
  const routed = status?.modelRouter ?? false;
  const { data: models } = useProviderModels(
    routed ? null : agentId,
    pair?.harness ?? null,
    pair?.provider ?? null,
  );
  const { data: catalogModels } = useHarnessCatalogModels(
    routed ? agentId : null,
    pair?.harness ?? null,
  );
  if (!pair || !routesSessionPairs(carried)) return null;
  const groups = modelGroups(catalogModels);

  const save = (next: SessionPair) => {
    const kept =
      remembered?.harness === next.harness && remembered.settings
        ? settingsForModel(
            carried.find((h) => h.name === next.harness),
            groups,
            next.model,
            remembered.settings,
          )
        : {};
    rememberSessionPair(
      agentId,
      Object.keys(kept).length > 0 ? { ...next, settings: kept } : next,
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
        ? carried
            .find((h) => h.name === pair.harness)
            ?.harnessConfigCatalog?.options.find((o) => o.category === "model")
            ?.choices
        : models?.availableModels) ?? []);
  const providerOfModel = (model: string | null): string | null =>
    groups.find((g) => g.models.some((m) => sameModel(m.name, model)))
      ?.connectionId ?? pair.provider;

  return (
    <section className="mt-6">
      <SectionLabel spaced>Default for new sessions</SectionLabel>
      <OptionField title="Harness">
        <OptionPicker
          title="Harness"
          choices={harnesses.map((h) => ({ id: h.name, name: h.displayName }))}
          value={pair.harness}
          onSelect={(harness) =>
            harness &&
            save({ harness, provider: fitting(harness)[0]!, model: null })
          }
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
        <OptionPicker
          title="Model"
          choices={modelChoices.map((m) => ({ id: m.value, name: m.name }))}
          value={
            routed
              ? (findModel(groups, pair.model)?.model.name ?? pair.model)
              : pair.model
          }
          clearable
          onSelect={(model) =>
            save({ ...pair, provider: providerOfModel(model), model })
          }
        />
      </OptionField>
    </section>
  );
}
