import { Settings } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddRow } from "@/components/ui/list-section";

import { useStore } from "../../../store.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { ProviderToggleRow } from "../../providers/components/provider-toggle-row.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
} from "../../sessions/api/session-pair.js";
import { DetachProviderMessage } from "../../sessions/components/detach-provider-message.js";
import { useProviderUsage } from "../../sessions/hooks/use-provider-usage.js";
import { providerHarnesses } from "../../sessions/lib/session-pair-options.js";
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
      <SessionDefaultsSection agentId={agentId} />
    </div>
  );
}
