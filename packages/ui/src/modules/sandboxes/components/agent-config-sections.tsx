import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SleepAfterIdleField } from "./lifecycle-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: how long the Agent sleeps when idle, apart from
 * the model settings that shared its General page: the Agent panel of the
 * unified toolbar shows it alone, and the page keeps both through its own
 * composition. Size is no longer a setting, since every Agent runs in a microVM
 * of one size.
 */
export function AgentSleepSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const updateSleep = useUpdateAgent();
  const hibernationTimeoutMin =
    (updateSleep.isPending
      ? updateSleep.variables.hibernationTimeoutMin
      : undefined) ?? agent.hibernationTimeoutMin;
  return (
    <section className="mb-8">
      <SleepAfterIdleField
        value={hibernationTimeoutMin}
        onChange={async (next) => {
          if (
            await confirmHibernationChange(
              agent.hibernationTimeoutMin,
              next,
              showConfirm,
            )
          )
            updateSleep.mutate({
              id: agent.id,
              hibernationTimeoutMin: next,
            });
        }}
      />
    </section>
  );
}

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
