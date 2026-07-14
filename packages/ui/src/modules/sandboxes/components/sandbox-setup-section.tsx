import { Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { FIELD_INSET, Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { ProviderSection } from "../../providers/components/provider-section.js";
import type { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { HibernationTimeoutField } from "./hibernation-timeout-field.js";
import { SandboxModelSettings } from "./sandbox-model-settings.js";

const READ_ONLY_FIELD =
  "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-4 text-sm text-muted-foreground";

type SandboxSettingsForm = ReturnType<typeof useSandboxSettingsForm>;

interface Props {
  f: SandboxSettingsForm;
}

export function SandboxSetupSection({ f }: Props) {
  const { agent } = f;
  if (!agent) return null;

  return (
    <>
      <section className="mb-8">
        <FormField label="Name" error={f.errors.name?.message}>
          <Input disabled={f.saving} {...f.register("name")} />
        </FormField>
      </section>

      <section className="mb-8">
        {/* Read-only: image/template are create-only — changing them would mean
            delete+recreate, destroying the workspace PVC. */}
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
        <ProviderSection
          variant="collapsible"
          listClassName={FIELD_INSET}
          selected={f.selectedProvider}
          onSelect={f.selectProvider}
          onProviderRemoved={f.dropProviderGrant}
        />
        <p className="mt-3 text-[12px] text-muted-foreground">
          Changing the provider swaps this sandbox's model credential. A
          cross-family switch (e.g. Anthropic → OpenAI on a Claude image) can
          break the agent and may need a restart.
        </p>
      </section>

      <SandboxModelSettings agentId={agent.id} />

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <Inset className="rounded-lg border border-border p-4">
          <AgentEgressEditor
            agentId={agent.id}
            currentPreset={f.currentPreset}
            staged={f.egressStaged}
          />
        </Inset>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Lifecycle</SectionLabel>
        <Inset className="rounded-lg border border-border p-4">
          <HibernationTimeoutField
            register={f.register("hibernationTimeoutMin", {
              valueAsNumber: true,
            })}
            value={f.hibernationTimeoutMin}
            error={f.errors.hibernationTimeoutMin?.message}
            disabled={f.saving}
          />
        </Inset>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Environment</SectionLabel>
        <Inset className="rounded-lg border border-border p-4">
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
        </Inset>
      </section>
    </>
  );
}
