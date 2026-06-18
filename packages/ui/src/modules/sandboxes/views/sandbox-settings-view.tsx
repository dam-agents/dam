import { ArrowLeft } from "@carbon/icons-react";
import { Controller } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import { FormError } from "../../../components/form-error.js";
import { EnvTab } from "../../agents/components/configure-agent/env-tab.js";
import { AgentEgressEditor } from "../../egress-rules/components/agent-egress-editor.js";
import { ProviderSection } from "../../providers/components/provider-section.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { FormField } from "../components/form-field.js";
import { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";

const READ_ONLY_FIELD =
  "flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-4 text-sm text-muted-foreground";

export function SandboxSettingsView() {
  const f = useSandboxSettingsForm();

  if (f.status !== "ready" || !f.agent) {
    return (
      <div className="mx-auto w-full max-w-[666px]">
        <BackLink onClick={f.goBack} />
        {f.status === "no-agent" && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            No sandbox selected.
          </p>
        )}
        {f.status === "not-found" && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Sandbox not found.
          </p>
        )}
      </div>
    );
  }

  const { agent } = f;

  return (
    <div className="mx-auto w-full max-w-[666px]">
      <BackLink onClick={f.goBack} />
      <h1 className="mb-8 text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
        {agent.name}
      </h1>

      <section className="mb-8">
        <SectionLabel spaced>Name</SectionLabel>
        <FormField>
          <Input disabled={f.saving} {...f.register("name")} />
        </FormField>
        <FormError message={f.errors.name?.message} />
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Image</SectionLabel>
        {/* Read-only: image/template are create-only — changing them would mean
            delete+recreate, destroying the workspace PVC. */}
        <FormField>
          <div className={READ_ONLY_FIELD}>
            <span className={`truncate ${agent.templateId ? "" : "font-mono"}`}>
              {f.templateName ?? agent.image}
            </span>
          </div>
        </FormField>
        {agent.templateId && (
          <p className="mt-1.5 truncate font-mono text-[12px] text-muted-foreground">
            {agent.image}
          </p>
        )}
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Provider</SectionLabel>
        <ProviderSection
          variant="collapsible"
          listClassName="md:-ml-4"
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

      <ConnectionsSection
        grantedIds={f.grantedAppIds}
        onToggleGrant={f.toggleAppGrant}
        oauthReturnView={`/sandboxes/${agent.id}`}
      />

      <section className="mb-8">
        <SectionLabel spaced>Network access</SectionLabel>
        <FormField className="rounded-lg border border-border p-4">
          <AgentEgressEditor
            agentId={agent.id}
            currentPreset={f.currentPreset}
            staged={f.egressStaged}
          />
        </FormField>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Environment</SectionLabel>
        <FormField className="rounded-lg border border-border p-4">
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
        </FormField>
      </section>

      <div className="flex items-center justify-end gap-3 pb-4">
        {f.wildcardHostInScope && (
          <span
            role="alert"
            className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-warning"
            title="A wildcard host '*' rule is in scope. Any unmatched egress is allowed."
          >
            <span aria-hidden="true">⚠</span>
            Allow everything is on — narrow with deny rules or remove the
            wildcard.
          </span>
        )}
        <Button onClick={f.onSave} disabled={f.isSubmitDisabled}>
          {f.saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-ml-2 h-auto self-start px-2 py-1 text-[16px] leading-[22.75px] text-muted-foreground hover:text-foreground font-normal"
    >
      <ArrowLeft size={16} /> Back to Sandboxes
    </Button>
  );
}
