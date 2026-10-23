import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import type { AgentView } from "../../../types.js";
import { useUpdateSandbox } from "../hooks/use-update-sandbox.js";

interface Props {
  agents: readonly AgentView[];
  noun?: string;
}

export function OutdatedTemplatesBanner({ agents, noun = "agents" }: Props) {
  const update = useUpdateSandbox();
  const outdated = agents.filter((agent) => agent.templateUpdate);

  if (outdated.length < 2) return null;

  return (
    <Callout
      tone="info"
      size="sm"
      className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Renew size={16} className="shrink-0 text-accent" />
        <span>
          <strong className="font-medium text-foreground">
            {outdated.length} {noun}
          </strong>{" "}
          out of date — newer images available upstream.
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        disabled={update.updatingAll || update.updatingId !== null}
        className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
        onClick={() => void update.updateAll(outdated)}
      >
        <Renew size={16} />
        {update.updatingAll ? "Updating…" : "Update all"}
      </Button>
    </Callout>
  );
}
