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
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { DefaultModelNotice } from "../../agents/components/default-model-notice.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";
import { ProviderToggleRow } from "../../providers/components/provider-toggle-row.js";
import {
  rememberSessionPair,
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
  useRememberedPair,
} from "../../sessions/api/session-pair.js";
import { AwakeModelsGate } from "../../sessions/components/awake-models-gate.js";
import { DetachProviderMessage } from "../../sessions/components/detach-provider-message.js";
import { SessionPairPicker } from "../../sessions/components/session-pair-picker.js";
import { useProviderUsage } from "../../sessions/hooks/use-provider-usage.js";
import {
  fittingProviders,
  harnessOptions,
  nextPair,
  providerHarnesses,
} from "../../sessions/lib/session-pair-options.js";
import { ConnectionSpendLimit } from "../../spend/components/connection-spend-limit.js";
import { RootDriverSpendNote } from "../../spend/components/root-driver-spend-note.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";
import { SessionDefaultsSection } from "./session-defaults-section.js";

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
  const usage = useProviderUsage(agentId);
  const newLayout = useNewLayout();

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
                    <DetachProviderMessage name={p.name} usage={usage(p)} />,
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
      {newLayout ? (
        <DefaultPairPicker key={agentId} agentId={agentId} />
      ) : (
        <SessionDefaultsSection agentId={agentId} />
      )}
    </div>
  );
}

function DefaultPairPicker({ agentId }: { agentId: string }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data: status } = useHarnessConfigStatus(agentId);
  const operable = useIsAgentOperable(agentId);
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
  const [draft, setDraft] = useState<SessionPair | null>(null);
  const saved = nextPair(
    null,
    remembered ?? null,
    harnesses.map((h) => h.name),
    fitting,
    status?.defaultHarness,
  );
  const pair =
    routed && draft !== null && draft.harness !== saved?.harness
      ? draft
      : saved;
  if (status && !status.harnesses && !operable)
    return (
      <section className="mt-6">
        <SectionLabel spaced>Default for new sessions</SectionLabel>
        <AwakeModelsGate agentId={agentId} />
      </section>
    );
  if (!pair || !routesSessionPairs(carried)) return null;
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
            value: pair,
            onChoose: (next) => {
              if (routed && next.model === null) return setDraft(next);
              rememberSessionPair(agentId, next);
              setDraft(null);
            },
          }}
        />
        {pair !== saved ? (
          <p role="status" className="pl-3 text-xs text-muted-foreground">
            Pick a model to save this harness as the default.
          </p>
        ) : (
          <DefaultModelNotice agentId={agentId} />
        )}
      </div>
    </section>
  );
}
