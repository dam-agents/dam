import { Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { READ_ONLY_FIELD } from "@/components/ui/read-only-field";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { KnowledgeSection } from "../../knowledge-bases/components/knowledge-section.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import type { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { HibernationTimeoutField } from "./hibernation-timeout-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";
import { SandboxSizeSection } from "./sandbox-size-section.js";

type SandboxSettingsForm = ReturnType<typeof useSandboxSettingsForm>;

interface Props {
  f: SandboxSettingsForm;
}

export function SandboxSetupSection({ f }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { agent } = f;
  if (!agent) return null;

  const confirmSwitch = () =>
    showConfirm(
      <p>
        This will change the model provider used by{" "}
        <strong>{agent.name}</strong>. Switching between different model
        families (for example, Claude → OpenAI) may cause the agent to stop
        working and can interrupt tasks in progress. The switch applies when you
        save.
      </p>,
      "Switch this agent's provider?",
      { confirmLabel: "Switch provider" },
    );

  return (
    <>
      <section className="mb-8">
        <FormField label="Name" error={f.errors.name?.message}>
          <Input disabled={f.saving} {...f.register("name")} />
        </FormField>
      </section>

      <SandboxSizeSection
        sizeCpuMilli={f.sizeCpuMilli}
        sizeMemoryMi={f.sizeMemoryMi}
        onChange={f.setSize}
        disabled={f.saving}
        currentSize={f.sizeRestartsAgent ? agent.size : undefined}
      />

      <section className="mb-8">
        <FormField
          label="Image"
          hint={
            agent.templateId ? (
              <span className="truncate font-mono">{agent.image}</span>
            ) : undefined
          }
        >
          <div className={READ_ONLY_FIELD}>
            <span className={`truncate ${agent.templateId ? "" : "font-mono"}`}>
              {f.templateName ?? agent.image}
            </span>
          </div>
        </FormField>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <Inset>
          <ProviderSelect
            selected={f.selectedProvider}
            onSelect={f.selectProvider}
            confirmSwitch={confirmSwitch}
            disabled={f.saving}
            required={f.formReady}
          />
        </Inset>
        <p className="mt-3 text-xs text-muted-foreground">
          Changing the provider swaps this agent's model credential. A
          cross-family switch (e.g. Anthropic → OpenAI on a Claude image) can
          break the agent and may need a restart.
        </p>
      </section>

      <SandboxModelSettings agentId={agent.id} draft={f.harnessDraft} />

      <KnowledgeSection agent={agent} />

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <Callout inset>
          <AgentEgressEditor
            agentId={agent.id}
            currentPreset={f.currentPreset}
            staged={f.egressStaged}
          />
        </Callout>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Lifecycle</SectionLabel>
        <Callout inset>
          <HibernationTimeoutField
            register={f.register("hibernationTimeoutMin", {
              valueAsNumber: true,
            })}
            value={f.hibernationTimeoutMin}
            error={f.errors.hibernationTimeoutMin?.message}
            disabled={f.saving}
          />
        </Callout>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Environment</SectionLabel>
        <Callout inset>
          <Controller
            control={f.control}
            name="envVars"
            render={({ field }) => (
              <EnvTab
                inherited={f.inheritedEnvs}
                envVars={field.value}
                setEnvVars={field.onChange}
                saving={f.saving}
              />
            )}
          />
        </Callout>
      </section>
    </>
  );
}
