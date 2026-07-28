import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";

import type { AgentView } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import { generateSandboxName } from "../../sandboxes/lib/sandbox-name.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import {
  buildCreateAgentInput,
  type CreateAgentDraft,
  isCreateAgentDraftComplete,
} from "../lib/create-agent-input.js";

interface Props {
  /** Called with the freshly created agent once the create mutation resolves. */
  onCreated: (agent: AgentView) => void;
}

/**
 * Minimal, self-contained agent-create form for surfaces that can't leave the
 * page (the Slack/Telegram bind pickers). It reuses the sandbox wizard's own
 * building blocks — templates, provider selection, the create mutation — but
 * fixes the network preset to the trusted default so the whole thing fits in
 * one screen. Turns run under the chosen provider, so a provider is required.
 */
export function CreateAgentInline({ onCreated }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const createAgent = useCreateAgent();
  // Controlled state rather than the house RHF+Zod default for a 3-field form:
  // the provider is a bespoke imperative picker (not an RHF-registerable input),
  // and validation + mutation-input assembly already live in the tested pure
  // `create-agent-input` module.
  const [name, setName] = useState(generateSandboxName);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);

  // Default to the first non-experimental template until the user picks one,
  // computed here rather than leaning on the catalogue's sort order.
  const selectedTemplateId =
    templateId ??
    (templates.find((t) => !t.experimental) ?? templates[0])?.id ??
    null;

  const draft: CreateAgentDraft = {
    name,
    templateId: selectedTemplateId,
    providerRef,
    egressPreset: "trusted",
  };
  const canCreate = isCreateAgentDraftComplete(draft);

  const submit = async () => {
    if (!canCreate) return;
    try {
      const agent = await createAgent.mutateAsync(buildCreateAgentInput(draft));
      onCreated(agent);
    } catch {
      // useCreateAgent surfaces its own error toast; stay put so the user can retry.
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <FormField label="Name" labelInset>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-agent"
        />
      </FormField>

      <FormField label="Harness" labelInset>
        <Select
          value={selectedTemplateId ?? ""}
          disabled={isLoading || templates.length === 0}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
              {template.experimental ? " (experimental)" : ""}
            </option>
          ))}
        </Select>
      </FormField>

      <div>
        <SectionLabel spaced>Provider</SectionLabel>
        <ProviderSelect
          selected={providerRef}
          onSelect={setProviderRef}
          autoSelectFirst
        />
      </div>

      <Button
        type="button"
        className="self-start"
        disabled={createAgent.isPending || !canCreate}
        onClick={submit}
      >
        {createAgent.isPending ? "Creating…" : "Create agent"}
      </Button>
    </div>
  );
}
