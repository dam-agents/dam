import type { EntryPointChoice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";

interface EntryPoint {
  choice: EntryPointChoice;
  label: string;
}

const CREATE_AGENT: EntryPoint = { choice: "sandbox", label: "Create agent" };

const BROWSE_KITS: EntryPoint = {
  choice: "starter-kit",
  label: "Browse starter kits",
};

const CREATE_AGENT_FROM_KITS: EntryPoint = {
  ...BROWSE_KITS,
  label: "Create agent",
};

export function EntryPointButtons({
  surface,
}: {
  surface: "home" | "welcome";
}) {
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const defaultAgent = useCreateDefaultAgent();
  const recordEntryPoint = useRecordEntryPoint();
  const enter = (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    if (entryPoint === CREATE_AGENT) void defaultAgent.create();
    else setKitBrowserOpen(true);
  };
  const [lead, second] =
    surface === "welcome"
      ? [CREATE_AGENT_FROM_KITS]
      : [CREATE_AGENT, BROWSE_KITS];
  return (
    <>
      {second && (
        <Button
          variant="outline"
          onClick={() => enter(second)}
          data-testid="entry-point-second"
        >
          {second.label}
        </Button>
      )}
      <Button
        onClick={() => enter(lead)}
        disabled={lead === CREATE_AGENT && !defaultAgent.ready}
        data-testid="entry-point-lead"
      >
        {lead.label}
      </Button>
    </>
  );
}
