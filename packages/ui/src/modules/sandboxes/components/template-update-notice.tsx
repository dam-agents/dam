import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../../agents/api/mutations.js";

interface Props {
  agent: AgentView;
}

/** "Update available" banner under the Image field (#1077): the sandbox's
 *  template now ships a different image than the one captured at create. */
export function TemplateUpdateNotice({ agent }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();
  const update = agent.templateUpdate;
  if (!update) return null;

  // Mirrors sizeRestartsAgent: only a sandbox that's down applies lazily.
  const restartsOnUpgrade = !(agent.state === "hibernated" || agent.overBudget);

  const onUpgrade = async () => {
    const msg = (
      <>
        Upgrade sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong> to its
        template's current version? The image moves from{" "}
        <span className="font-mono text-[12px]">{update.fromImage}</span> to{" "}
        <span className="font-mono text-[12px]">{update.toImage}</span>.{" "}
        {restartsOnUpgrade
          ? "The sandbox restarts to apply it — in-flight work is interrupted."
          : "It applies when the sandbox next starts."}
      </>
    );
    if (!(await showConfirm(msg, "Upgrade Sandbox"))) return;
    // expectedToImage binds the confirmation to the diff shown above: if the
    // template moves meanwhile, the server rejects instead of surprising.
    upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
  };

  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-info/30 bg-info-light px-3 py-2">
      <span className="min-w-0 text-[12px] text-info">
        Update available — the template now ships{" "}
        <span className="break-all font-mono">{update.toImage}</span>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={upgrade.isPending}
        onClick={() => void onUpgrade()}
      >
        {upgrade.isPending ? "Upgrading…" : "Upgrade"}
      </Button>
    </div>
  );
}
