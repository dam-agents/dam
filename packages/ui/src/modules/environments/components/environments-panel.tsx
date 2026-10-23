import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useEnvironments } from "../api/queries.js";
import { EnvironmentCard } from "./environment-card.js";
import { NO_ENVIRONMENTS } from "./environments-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: JanUI's Environments tab of an agent's chat side
 * panel: the agent's Environments, each as the card of its Environments
 * section, with whether it runs, its expiry, a link per endpoint and the
 * owner's controls to extend and delete it. Who may open them is edited in
 * that section, which the tab links to; the agent creates them, so the tab
 * offers no create.
 */
export function EnvironmentsPanel({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  const environments = useEnvironments(agentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const list = environments.data ?? [];

  return (
    <SidebarSection
      title="Environments"
      open
      className={className}
      headerRight={
        <Button
          variant="link"
          size="inline"
          tone="muted"
          className="text-sm"
          data-testid="environments-panel-manage"
          onClick={() => navigateToSandboxHome(agentId, "environments")}
        >
          Who may open them
        </Button>
      }
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="environments-panel"
      >
        {environments.isError && list.length === 0 ? (
          <EmptyState bordered={false}>Couldn't load Environments.</EmptyState>
        ) : environments.isPending ? (
          <EmptyState bordered={false}>Loading…</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState bordered={false}>{NO_ENVIRONMENTS}</EmptyState>
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
