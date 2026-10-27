import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model settings the harness carries itself,
 * which belong to the Agent rather than to one session; the Providers panel
 * shows them below the providers and the defaults.
 */
export function AgentModelSettingsSection({ agentId }: { agentId: string }) {
  const { data: harnessStatus } = useHarnessConfigStatus(agentId);
  const carriedHarnesses = harnessStatus?.harnesses ?? null;
  if (!carriedHarnesses) return <SandboxModelSettings agentId={agentId} />;
  if (carriedHarnesses.some((h) => h.sessionSettings)) return null;
  return (
    <HarnessSettingsSections agentId={agentId} harnesses={carriedHarnesses} />
  );
}
