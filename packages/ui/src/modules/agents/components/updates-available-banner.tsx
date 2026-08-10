import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";

interface Props {
  agents: AgentView[];
}

export function UpdatesAvailableBanner({ agents }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();

  const outdated = agents.filter((a) => a.templateUpdate != null);
  if (outdated.length === 0) return null;

  const onUpdateAll = async () => {
    const msg = (
      <>
        Upgrade{" "}
        <strong className="text-foreground">
          {outdated.length} sandbox{outdated.length > 1 ? "es" : ""}
        </strong>{" "}
        to their latest template versions?
      </>
    );
    if (!(await showConfirm(msg, "Upgrade All"))) return;
    for (const agent of outdated) {
      upgrade.mutate({
        id: agent.id,
        expectedToImage: agent.templateUpdate!.toImage,
      });
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 mb-4">
      <Renew size={20} className="shrink-0 text-muted-foreground" />
      <p className="flex-1 text-[14px] text-muted-foreground">
        <strong className="font-semibold text-foreground">
          {outdated.length} sandbox{outdated.length > 1 ? "es" : ""}
        </strong>{" "}
        out of date — newer images available upstream.
      </p>
      <Button
        variant="ghost"
        size="sm"
        disabled={upgrade.isPending}
        onClick={() => void onUpdateAll()}
        className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
      >
        <Renew size={16} className="shrink-0" />
        Update all
      </Button>
    </div>
  );
}
