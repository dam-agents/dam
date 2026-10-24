import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import { parseCpuMilli, parseMemoryMi } from "../lib/quantity.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SleepAfterIdleField } from "./lifecycle-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";
import { SandboxSizeSection } from "./sandbox-size-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: how long the Agent sleeps when idle and how large
 * it runs, apart from the model settings that shared its General page: the
 * Agent panel of the unified toolbar shows them alone, and the page keeps
 * both through its own composition.
 */
export function AgentResourcesSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const updateSleep = useUpdateAgent();
  const updateSize = useUpdateAgent();
  const pendingSize = updateSize.isPending
    ? updateSize.variables.size
    : undefined;

  const hibernationTimeoutMin =
    (updateSleep.isPending
      ? updateSleep.variables.hibernationTimeoutMin
      : undefined) ?? agent.hibernationTimeoutMin;
  const sizeCpuMilli =
    parseCpuMilli(pendingSize?.cpu ?? agent.size.cpu) ?? 1000;
  const sizeMemoryMi =
    parseMemoryMi(pendingSize?.memory ?? agent.size.memory) ?? 1024;
  const sizeRestartsAgent = !(agent.state === "hibernated" || agent.overBudget);

  return (
    <>
      {!agent.vm && (
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
      )}

      {!agent.vm && (
        <SandboxSizeSection
          sizeCpuMilli={sizeCpuMilli}
          sizeMemoryMi={sizeMemoryMi}
          onChange={async (next) => {
            if (
              sizeRestartsAgent &&
              !(await showConfirm(
                "Changing the size restarts the agent — in-flight work is interrupted.",
                "Restart agent?",
                { confirmLabel: "Resize and restart" },
              ))
            )
              return;
            updateSize.mutate({
              id: agent.id,
              size: {
                cpu: `${next.sizeCpuMilli}m`,
                memory: `${next.sizeMemoryMi}Mi`,
              },
            });
          }}
          currentSize={sizeRestartsAgent ? agent.size : undefined}
        />
      )}
    </>
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
