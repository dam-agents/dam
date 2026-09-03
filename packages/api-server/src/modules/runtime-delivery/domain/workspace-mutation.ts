import type { RuntimeEventKind } from "api-server-api";

export const WORKSPACE_MUTATION_EVENT_KINDS = [
  "workspace-seed",
  "workspace-command",
] as const satisfies readonly RuntimeEventKind[];

export type WorkspaceMutationEventKind =
  (typeof WORKSPACE_MUTATION_EVENT_KINDS)[number];

export function isWorkspaceMutationKind(
  kind: string,
): kind is WorkspaceMutationEventKind {
  return (WORKSPACE_MUTATION_EVENT_KINDS as readonly string[]).includes(kind);
}
