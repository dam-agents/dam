import type { ReactNode } from "react";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the bar above a conversation that says the Agent's runtime is behind, in the caller's sentence. It carries no action: the platform moves an Agent to its Template's current image by itself, so nothing here asks its owner to think about versions.
 */
export function AgentOutdatedNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
    >
      {children}
    </div>
  );
}
