import { routesSessionPairs } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../../sessions/api/session-pair.js";
import { OptionPicker } from "../../sessions/components/model-settings-panel.js";
import { OptionField } from "../../sessions/components/option-field.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
} from "../../sessions/lib/session-pair-options.js";

export function SandboxProvidersSection({ agentId }: { agentId: string }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { owned, granted, loaded } = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);

  return (
    <div className="flex flex-col gap-3">
      {loaded && owned.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No providers connected yet.
        </p>
      )}
      {owned.map((p) => {
        const attached = granted.some((g) => g.id === p.id);
        return (
          <Card key={p.id} className="flex items-center gap-3 p-4">
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
                        Sessions running on <strong>{p.name}</strong> stop until
                        it is attached again. Schedules and channels that use it
                        move to another provider.
                      </p>,
                      `Disconnect ${p.name} from this agent?`,
                      { kind: "destructive", confirmLabel: "Disconnect" },
                    ).then((ok) => ok && revoke(p.id))
              }
            />
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
  const fallback =
    harnesses.find((h) => h.name === status?.defaultHarness) ?? harnesses[0];
  const pair =
    nextPair(
      null,
      remembered ?? null,
      harnesses.map((h) => h.name),
      fitting,
    ) ??
    (fallback && {
      harness: fallback.name,
      provider: fitting(fallback.name)[0]!,
      model: null,
    });
  const { data: models } = useProviderModels(
    agentId,
    pair?.harness ?? null,
    pair?.provider ?? null,
  );
  if (!pair || !routesSessionPairs(carried)) return null;

  const save = (next: SessionPair) =>
    rememberSessionPair(
      agentId,
      remembered?.harness === next.harness && remembered.settings
        ? { ...next, settings: remembered.settings }
        : next,
    );
  const modelChoices =
    (models?.availableModels === null
      ? carried
          .find((h) => h.name === pair.harness)
          ?.harnessConfigCatalog?.options.find((o) => o.category === "model")
          ?.choices
      : models?.availableModels) ?? [];

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
      <OptionField title="Model">
        <OptionPicker
          title="Model"
          choices={modelChoices.map((m) => ({ id: m.value, name: m.name }))}
          value={pair.model}
          clearable
          onSelect={(model) => save({ ...pair, model })}
        />
      </OptionField>
    </section>
  );
}
