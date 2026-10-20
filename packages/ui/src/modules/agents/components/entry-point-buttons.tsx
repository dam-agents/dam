import { Add, DataEnrichmentAdd } from "@carbon/icons-react";
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

export function EntryPointButtons() {
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const defaultAgent = useCreateDefaultAgent();
  const recordEntryPoint = useRecordEntryPoint();
  const enter = (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    if (entryPoint === CREATE_AGENT) void defaultAgent.create();
    else setKitBrowserOpen(true);
  };
  return (
    <>
      <Button
        variant="outline"
        onClick={() => enter(BROWSE_KITS)}
        data-testid="entry-point-second"
      >
        <DataEnrichmentAdd size={16} aria-hidden />
        {BROWSE_KITS.label}
      </Button>
      <Button
        onClick={() => enter(CREATE_AGENT)}
        disabled={!defaultAgent.ready}
        data-testid="entry-point-lead"
      >
        <Add size={16} aria-hidden />
        {CREATE_AGENT.label}
      </Button>
    </>
  );
}
