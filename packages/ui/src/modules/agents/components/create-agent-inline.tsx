import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { AgentView } from "../../../types.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { useCreateAgent } from "../api/mutations.js";
import { usePrefilledSandboxName } from "../hooks/use-default-sandbox-name.js";
import {
  buildCreateAgentInput,
  type CreateAgentDraft,
  isCreateAgentDraftComplete,
} from "../lib/create-agent-input.js";
import { AGENT_NAME_PREFIX } from "../lib/sandbox-name.js";
import { VmRuntimeNotice } from "./vm-runtime-notice.js";

interface Props {
  onCreated: (agent: AgentView) => void;
}

export function CreateAgentInline({ onCreated }: Props) {
  const vmRuntime = useVmRuntime();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");
  usePrefilledSandboxName(AGENT_NAME_PREFIX, name, setName);

  const draft: CreateAgentDraft = {
    name,
    egressPreset: "trusted",
    vm: vmRuntime.vm,
  };
  const canCreate = isCreateAgentDraftComplete(draft) && vmRuntime.answered;

  const submit = async () => {
    if (!canCreate) return;
    try {
      const agent = await createAgent.mutateAsync(buildCreateAgentInput(draft));
      onCreated(agent);
    } catch {}
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <VmRuntimeNotice />

      <FormField label="Name" labelInset>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="my-agent"
        />
      </FormField>

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
