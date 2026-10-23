import type { ReactNode } from "react";

import type { AgentView } from "../../../types.js";
import { UpdateAvailableAction } from "./update-available-action.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the bar above a conversation that says the Agent's runtime is behind, with the action that moves it forward. The sentence is the caller's; the chrome, the Update button and its pending label are the same for every reason the runtime falls behind.
 */
export function AgentOutdatedNotice({
  agent,
  onUpdate,
  pending,
  children,
}: {
  agent: AgentView;
  onUpdate: () => void;
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="flex-1">{children}</span>
      <UpdateAvailableAction
        agent={agent}
        onUpdate={onUpdate}
        pending={pending}
      />
    </div>
  );
}
