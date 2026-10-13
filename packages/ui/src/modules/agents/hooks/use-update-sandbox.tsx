import { useCallback } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";
import { ReleaseNotesLink } from "../components/release-notes-link.js";
import { releaseNotesUrl } from "./use-release-notes-url.js";

function restartsToApply(agent: AgentView): boolean {
  return !(agent.state === "hibernated" || agent.overBudget);
}

export function useUpdateSandbox() {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: templates } = useTemplates();
  const upgrade = useUpgradeAgentMutation();

  const updateOne = useCallback(
    async (agent: AgentView) => {
      const update = agent.templateUpdate;
      if (!update) return;
      const msg = (
        <>
          Update agent{" "}
          <strong className="text-foreground">"{agent.name}"</strong> to its
          template's current version? The image moves from{" "}
          <span className="font-mono text-xs">{update.fromImage}</span> to{" "}
          <span className="font-mono text-xs">{update.toImage}</span>.{" "}
          {restartsToApply(agent)
            ? "The agent restarts to apply it — in-flight work is interrupted."
            : "It applies when the agent next starts."}
          <ReleaseNotesLink
            href={releaseNotesUrl(templates, agent.templateId)}
            className="mt-2 flex w-fit"
          />
        </>
      );
      if (
        !(await showConfirm(msg, "Update agent?", { confirmLabel: "Update" }))
      )
        return;
      upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
    },
    [showConfirm, upgrade, templates],
  );

  return {
    updateOne,
    updatingId: upgrade.isPending ? upgrade.variables.id : null,
  };
}
