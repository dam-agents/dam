import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { ModelSettingsPanel } from "../../sessions/components/model-settings-panel.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";

/**
 * Sandbox-home Model Settings: the shared panel in its page variant, gated by
 * the agent's lifecycle. Editable only while operable; asleep it shows the
 * last-known values read-only with a "Start agent to edit" action, and a
 * spinner while the agent is coming up.
 */
export function SandboxModelSettings({ agentId }: { agentId: string }) {
  const { operable, comingUp } = useOperableState(agentId);
  const { data: status } = useHarnessConfigStatus(agentId);
  const hasCatalog = !!status?.catalog && status.catalog.options.length > 0;

  // The panel renders nothing without a catalog (the agent hasn't hello'd yet),
  // which while asleep would also hide the wake affordance — so surface a
  // minimal start-to-configure fallback in that case.
  if (!hasCatalog && !operable) {
    return (
      <section className="mb-8">
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          <SectionLabel>Model settings</SectionLabel>
          <WakeToEditButton agentId={agentId} comingUp={comingUp} />
        </div>
        <Inset className="rounded-lg border border-border p-4">
          <p className="text-[13px] text-muted-foreground">
            Start the agent to load and edit its model settings.
          </p>
        </Inset>
      </section>
    );
  }

  return (
    <ModelSettingsPanel
      agentId={agentId}
      variant="page"
      disabled={!operable}
      headerAction={
        operable ? undefined : (
          <WakeToEditButton agentId={agentId} comingUp={comingUp} />
        )
      }
    />
  );
}
