import { Settings } from "@carbon/icons-react";
import { routesSessionPairs } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddRow } from "@/components/ui/list-section";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { DefaultModelNotice } from "../../agents/components/default-model-notice.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { ProviderToggleRow } from "../../providers/components/provider-toggle-row.js";
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
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import {
  findModel,
  modelGroups,
  sameModel,
} from "../../sessions/lib/catalog-groups.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
  providerHarnesses,
} from "../../sessions/lib/session-pair-options.js";
import { settingsForModel } from "../../sessions/lib/session-settings.js";
import { ConnectionSpendLimit } from "../../spend/components/connection-spend-limit.js";
import { RootDriverSpendNote } from "../../spend/components/root-driver-spend-note.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";

export function SandboxProvidersSection({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { owned, granted, loaded } = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);
  const catalog = useHarnessCatalog().data?.harnesses;
  const root = useRootDriver(agentId);

  return (
    <div className="flex flex-col gap-3">
      {header()}
      {root && <RootDriverSpendNote root={root} />}
      {loaded && owned.length === 0 && (
        <EmptyState
          action={
            <Button size="sm" onClick={() => navigateToSettings("providers")}>
              Connect a provider
            </Button>
          }
        >
          No providers connected yet. Connect one in Settings to let this agent
          reach a model.
        </EmptyState>
      )}
      {owned.map((p) => {
        const attached = granted.some((g) => g.id === p.id);
        return (
          <ProviderToggleRow
            key={p.id}
            provider={p}
            harnesses={catalog && providerHarnesses(catalog, p)}
            checked={attached}
            disabled={pending}
            onCheckedChange={(on) =>
              on
                ? void grant(p.id)
                : void showConfirm(
                    <p>
                      Sessions running on <strong>{p.name}</strong> stop until
                      it is attached again. Schedules and channels that use it
                      don&rsquo;t run until you choose another model.
                    </p>,
                    `Disconnect ${p.name} from this agent?`,
                    { kind: "destructive", confirmLabel: "Disconnect" },
                  ).then((ok) => ok && revoke(p.id))
            }
          >
            {attached && root === null && p.templateId && (
              <ConnectionSpendLimit
                agentId={agentId}
                connectionId={p.id}
                connectionName={p.name}
                templateId={p.templateId}
              />
            )}
          </ProviderToggleRow>
        );
      })}
      {owned.length > 0 && (
        <Card className="overflow-hidden">
          <AddRow onClick={() => navigateToSettings("providers")}>
            <Settings size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-md font-medium text-foreground">
                Manage providers
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Connect another LLM provider to give this agent more models.
              </p>
            </div>
          </AddRow>
        </Card>
      )}
      <DefaultPairPicker key={agentId} agentId={agentId} />
    </div>
  );
}

function DefaultPairPicker({ agentId }: { agentId: string }) {
  const newLayout = useNewLayout();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
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
  const routed = status?.modelRouter ?? false;
  const [draftHarness, setDraftHarness] = useState<string | null>(null);
  const saved = nextPair(
    null,
    remembered ?? null,
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
  if (!pair || !routesSessionPairs(carried)) return null;
  if (newLayout)
    return (
      <section className="mt-6">
        <SectionLabel spaced>Default for new sessions</SectionLabel>
        <div className="flex flex-col gap-2">
          <SessionPairPicker
            agentId={agentId}
            carried={carried}
            defaultHarness={status?.defaultHarness ?? pair.harness}
            routed={routed}
            onConnectProviders={() => navigateToSettings("providers")}
            defaultPair={{
              value: saved,
              onChoose: (next) => rememberSessionPair(agentId, next),
            }}
          />
          <DefaultModelNotice agentId={agentId} />
        </div>
      </section>
    );
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
      </OptionField>
    </section>
  );
}
