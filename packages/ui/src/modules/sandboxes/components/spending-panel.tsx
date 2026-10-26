import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Spending panel of the unified toolbar: what
 * the Agent spends on models, the daily limit and the API spend with its
 * breakdown. What the Agent is, how it sleeps and how it is managed live in
 * its row menu and its rename dialog, not here.
 */
export function SpendingPanel({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <SandboxUsageSection agentId={agentId} />
    </div>
  );
}
