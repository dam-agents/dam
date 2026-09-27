import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";

import type { AgentView } from "../../../types.js";
import { useBackendOffer } from "../../features/hooks/use-backend-offer.js";
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
import { backendLine, effectiveBackend } from "../lib/create-backend.js";
import { AGENT_NAME_PREFIX } from "../lib/sandbox-name.js";

interface Props {
  onCreated: (agent: AgentView) => void;
}

export function CreateAgentInline({ onCreated }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const backendOffer = useBackendOffer();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [providerRef, setProviderRef] = useState<ProviderRef | null>(null);
  usePrefilledSandboxName(AGENT_NAME_PREFIX, name, setName);

  const selectedTemplate =
    templates.find((t) => t.id === templateId) ??
    templates.find((t) => !t.experimental) ??
    templates[0];
  const selectedTemplateId = selectedTemplate?.id ?? null;
  const backend = effectiveBackend({
    offer: backendOffer,
    containerOnlyReason: selectedTemplate?.containerOnlyReason,
    picked: null,
  });

  const draft: CreateAgentDraft = {
    name,
    templateId: selectedTemplateId,
    providerRef,
    egressPreset: "trusted",
    vm: backend === "vm",
  };
  const canCreate = isCreateAgentDraftComplete(draft) && backendOffer.answered;

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
        {backendOffer.vmOffered && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {backendLine(backend, selectedTemplate?.containerOnlyReason)}
          </p>
        )}
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
