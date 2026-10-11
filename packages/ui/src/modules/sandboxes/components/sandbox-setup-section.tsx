import { providerTypeForTemplateId } from "api-server-api";

import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  useSetAgentConnections,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
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
  const updateAgent = useUpdateAgent();
  const pending = updateAgent.isPending ? updateAgent.variables : undefined;

  const hibernationTimeoutMin =
    pending?.hibernationTimeoutMin ?? agent.hibernationTimeoutMin;
  const sizeCpuMilli =
    parseCpuMilli(pending?.size?.cpu ?? agent.size.cpu) ?? 1000;
  const sizeMemoryMi =
    parseMemoryMi(pending?.size?.memory ?? agent.size.memory) ?? 1024;
  const requireConnectionAddress =
    pending?.requireConnectionAddress ?? agent.requireConnectionAddress;
  const sizeRestartsAgent = !(agent.state === "hibernated" || agent.overBudget);

  return (
    <>
      {!carriedHarnesses && <AgentProviderSection agent={agent} />}

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
              updateAgent.mutate({ id: agent.id, hibernationTimeoutMin: next });
          }}
        />
      </section>

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
          updateAgent.mutate({
            id: agent.id,
            size: {
              cpu: `${next.sizeCpuMilli}m`,
              memory: `${next.sizeMemoryMi}Mi`,
            },
          });
        }}
        currentSize={sizeRestartsAgent ? agent.size : undefined}
      />

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
              updateAgent.mutate({
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

function AgentProviderSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: apps = [] } = useAppConnections();
  const { data: agentConnections } = useAgentConnections(agent.id);
  const setConnections = useSetAgentConnections();
  const providerAppIds = new Set(
    apps
      .filter((a) => providerTypeForTemplateId(a.templateId) !== null)
      .map((a) => a.id),
  );
  const connectionIds =
    agentConnections?.connections.map((c) => c.connectionId) ?? [];
  const selectedId = connectionIds.find((id) => providerAppIds.has(id));

  return (
    <section className="mb-8">
      <SectionLabel spaced>Provider</SectionLabel>
      <ProviderSelect
        selected={selectedId ? { id: selectedId } : null}
        onSelect={(ref) => {
          if (!ref || !agentConnections) return;
          setConnections.mutate({
            agentId: agent.id,
            connectionIds: [
              ...connectionIds.filter((id) => !providerAppIds.has(id)),
              ref.id,
            ],
          });
        }}
        confirmSwitch={() =>
          showConfirm(
            <p>
              This changes the model provider used by{" "}
              <strong>{agent.name}</strong> right away. Switching between
              different model families (for example, Claude → OpenAI) may cause
              the agent to stop working and can interrupt tasks in progress.
            </p>,
            "Switch this agent's provider?",
            { confirmLabel: "Switch provider" },
          )
        }
        disabled={setConnections.isPending}
        required={agentConnections !== undefined}
      />
      <p className="mt-3 text-sm text-muted-foreground">
        Changing the provider swaps this agent's model credential. A
        cross-family switch (e.g. Anthropic → OpenAI on a Claude image) can
        break the agent and may need a restart.
      </p>
    </section>
  );
}
