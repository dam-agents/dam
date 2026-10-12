import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";

export function useConfirmDeleteAgent() {
  const showConfirm = useStore((s) => s.showConfirm);
  return (agent: AgentView): Promise<boolean> =>
    showConfirm(
      <>
        This also deletes <strong>all its persistent data</strong> and cannot be
        undone.
      </>,
      `Delete agent “${agent.name}”?`,
      { kind: "destructive", confirmLabel: "Delete agent" },
    );
}
