import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useUpdateAgent } from "../../../agents/api/mutations.js";

export function ConnectionAddressingSection({ agent }: { agent: AgentView }) {
  const showConfirm = useStore((s) => s.showConfirm);
  const update = useUpdateAgent();
  const value =
    (update.isPending
      ? update.variables.requireConnectionAddress
      : undefined) ?? agent.requireConnectionAddress;

  const onChange = async (next: boolean) => {
    if (
      await showConfirm(
        "This restarts the agent's gateway to change how it injects credentials — requests in flight through it fail.",
        "Restart gateway?",
        { confirmLabel: "Change & restart" },
      )
    )
      update.mutate({ id: agent.id, requireConnectionAddress: next });
  };

  return (
    <section className="mb-8">
      <SectionLabel spaced>Credential injection</SectionLabel>
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-foreground">
            Inject only into addressed requests
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Credentials go only into requests that name a connection; others are
            sent as-is. The browser panel needs it. Turn it off for an agent
            whose tools need credentials added to requests that name no
            connection.
          </span>
        </span>
        <Switch
          checked={value}
          onCheckedChange={(next) => void onChange(next)}
          label="Inject only into addressed requests"
        />
      </label>
    </section>
  );
}
