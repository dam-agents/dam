import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SleepAfterIdleField } from "./lifecycle-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";

export function SandboxSetupSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: harnessStatus } = useHarnessConfigStatus(agent.id);
  const carriedHarnesses = harnessStatus?.harnesses ?? null;
  const updateSleep = useUpdateAgent();

  const hibernationTimeoutMin =
    (updateSleep.isPending
      ? updateSleep.variables.hibernationTimeoutMin
      : undefined) ?? agent.hibernationTimeoutMin;

  return (
    <>
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

      {!carriedHarnesses ? (
        <SandboxModelSettings agentId={agent.id} />
      ) : (
        !carriedHarnesses.some((h) => h.sessionSettings) && (
          <HarnessSettingsSections
            agentId={agent.id}
            harnesses={carriedHarnesses}
          />
        )
      )}
    </>
  );
}
