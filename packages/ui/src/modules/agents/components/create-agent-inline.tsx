import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";

import type { AgentView } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { ProviderSelect } from "../../providers/components/provider-select.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import { usePrefilledSandboxName } from "../hooks/use-default-sandbox-name.js";
import {
  buildCreateAgentInput,
  type CreateAgentDraft,
  isCreateAgentDraftComplete,
} from "../lib/create-agent-input.js";

interface Props {
  onCreated: (agent: AgentView) => void;
}

export function CreateAgentInline({ onCreated }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);
  usePrefilledSandboxName("coding-agent", name, setName);

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
    } catch {}
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
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
          required
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
    </Card>
  );
}
