import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useUpdateAgent } from "../../agents/api/mutations.js";
import { useFeatures } from "../../features/api/queries.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import { parseCpuMilli, parseMemoryMi } from "../lib/quantity.js";
import { HarnessSettingsSections } from "./harness-settings-sections.js";
import { SleepAfterIdleField } from "./lifecycle-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";
import { SandboxSizeSection } from "./sandbox-size-section.js";
import { ConnectionAddressingSetupSection } from "./setup/setup-sections.js";

export function SandboxSetupSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: harnessStatus } = useHarnessConfigStatus(agent.id);
  const carriedHarnesses = harnessStatus?.harnesses ?? null;
  const features = useFeatures();
  const updateSleep = useUpdateAgent();
  const updateSize = useUpdateAgent();
  const updateAddressing = useUpdateAgent();
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
  const requireConnectionAddress =
    (updateAddressing.isPending
      ? updateAddressing.variables.requireConnectionAddress
      : undefined) ?? agent.requireConnectionAddress;
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
                { confirmLabel: "Resize & restart" },
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

      {(features.data?.["strict-connection-addressing"] === true ||
        agent.requireConnectionAddress) && (
        <ConnectionAddressingSetupSection
          value={requireConnectionAddress}
          onChange={async (next) => {
            if (
              await showConfirm(
                "This restarts the agent's gateway to change how it injects credentials — requests in flight through it fail.",
                "Restart gateway?",
                { confirmLabel: "Change & restart" },
              )
            )
              updateAddressing.mutate({
                id: agent.id,
                requireConnectionAddress: next,
              });
          }}
        />
      )}

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
