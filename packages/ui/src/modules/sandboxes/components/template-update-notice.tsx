import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../../agents/api/mutations.js";

interface Props {
  agent: AgentView;
}

export function TemplateUpdateNotice({ agent }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();
  const update = agent.templateUpdate;
  if (!update) return null;

  const restartsOnUpgrade = !(agent.state === "hibernated" || agent.overBudget);

  const onUpgrade = async () => {
    const msg = (
      <>
        Upgrade sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong> to its
        template's current version? The image moves from{" "}
        <span className="font-mono text-xs">{update.fromImage}</span> to{" "}
        <span className="font-mono text-xs">{update.toImage}</span>.{" "}
        {restartsOnUpgrade
          ? "The sandbox restarts to apply it — in-flight work is interrupted."
          : "It applies when the sandbox next starts."}
      </>
    );
    if (!(await showConfirm(msg, "Upgrade Sandbox"))) return;
    upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
  };

  return (
    <Callout
      tone="muted"
      size="sm"
      inset
      className="mt-3 flex flex-wrap items-center gap-x-10 gap-y-1.5"
    >
      <p className="min-w-0 flex-1 basis-[280px] text-sm leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground/80">
          Update available.
        </strong>{" "}
        The template now ships{" "}
        <span className="break-all font-mono text-xs text-foreground">
          {update.toImage}
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
        disabled={upgrade.isPending}
        onClick={() => void onUpgrade()}
      >
        {upgrade.isPending ? "Upgrading…" : "Upgrade"}
      </Button>
    </Callout>
  );
}
