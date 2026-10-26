import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { useStore } from "../../../store.js";
import { useUnifiedRightToolbar } from "../../features/hooks/use-unified-right-toolbar.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useEnvironments } from "../api/queries.js";
import { EnvironmentCard } from "./environment-card.js";
import { AccessListEditor, NO_ENVIRONMENTS } from "./environments-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's Environments in the chat side panel:
 * the agent's Environments, each as the card of its Environments section, with
 * whether it runs, its expiry, a link per endpoint and the owner's controls to
 * extend and delete it. The agent creates them, so the tab offers no create.
 * Under the Unified right toolbar, where no configuration page holds the list
 * of people, it is edited above the cards, and the Agent panel's Manage row
 * opens the panel for it before the agent owns an Environment; every other
 * shell keeps the link to the page's section.
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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const rightToolbar = useUnifiedRightToolbar();

  return (
    <SidebarSection
      title="Environments"
      open
      className={className}
      headerRight={
        rightToolbar ? undefined : (
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
        )
      }
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="environments-panel"
      >
        {rightToolbar && (
          <div className="border-b border-border px-4 py-3">
            <AccessListEditor key={agentId} agentId={agentId} />
          </div>
        )}
        {environments.isPending ? (
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
