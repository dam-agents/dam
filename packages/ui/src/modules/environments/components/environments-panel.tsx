import { EmptyState } from "@/components/ui/empty-state";

import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useEnvironments } from "../api/queries.js";
import { EnvironmentCard } from "./environment-card.js";
import { AccessListEditor } from "./environments-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: JanUI's Environments tab of an agent's chat side
 * panel: the agent's Environments, each as the card of its Environments
 * section, with whether it runs, its expiry, a link per endpoint and the
 * owner's controls to extend and delete it, and the owner's list of who may
 * open them is edited above them. The agent creates them, so the tab offers no
 * create; the tab shows only once the agent owns one, and the Manage row of the
 * Agent panel opens it for the access list alone before then.
 */
export function EnvironmentsPanel({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  const environments = useEnvironments(agentId);
  const list = environments.data ?? [];

  return (
    <SidebarSection title="Environments" open className={className}>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="environments-panel"
      >
        <div className="border-b border-border px-4 py-3">
          <AccessListEditor agentId={agentId} />
        </div>
        {environments.isPending ? (
          <EmptyState bordered={false}>Loading…</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {list.map((environment) => (
              <li key={environment.id}>
                <EnvironmentCard environment={environment} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidebarSection>
  );
}
