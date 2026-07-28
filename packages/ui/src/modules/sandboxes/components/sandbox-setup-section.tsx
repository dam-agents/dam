import { Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import type { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { HibernationTimeoutField } from "./hibernation-timeout-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";
import { SandboxSizeSection } from "./sandbox-size-section.js";
import { TemplateUpdateNotice } from "./template-update-notice.js";

/** Disabled-input look for create-only values (image, harness) shown as text.
 *  Shared with the KB config page so the read-only field style can't drift. */
export const READ_ONLY_FIELD =
  "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-4 text-sm text-muted-foreground";

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
      "Switch this sandbox's provider?",
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
        restartNote={
          f.sizeRestartsAgent
            ? "Changing the size restarts the sandbox on save."
            : "The new size applies when the sandbox next starts."
        }
      />

      <section className="mb-8">
        {/* Read-only: image/template are create-only — changing them would mean
            delete+recreate, destroying the workspace PVC. The one sanctioned
            move is the template-upgrade path below (#1077). */}
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
        <TemplateUpdateNotice agent={agent} />
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <Inset>
          <ProviderSelect
            selected={f.selectedProvider}
            onSelect={f.selectProvider}
            confirmSwitch={confirmSwitch}
            disabled={f.saving}
          />
        </Inset>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Changing the provider swaps this sandbox's model credential. A
          cross-family switch (e.g. Anthropic → OpenAI on a Claude image) can
          break the agent and may need a restart.
        </p>
      </section>

      <SandboxModelSettings agentId={agent.id} />

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
