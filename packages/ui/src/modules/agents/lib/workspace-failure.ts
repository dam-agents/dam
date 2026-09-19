import type { AgentView } from "../../../types.js";

type WorkspaceFailure = AgentView["workspaceFailures"][number];

const STEP_LABELS: Record<string, string> = {
  "workspace-seed": "Seeding the workspace",
  "workspace-command": "The install command",
};

export function workspaceStepLabel(kind: string): string {
  return STEP_LABELS[kind] ?? kind;
}

export function workspaceRetryNote(failure: WorkspaceFailure): string {
  if (failure.settled) return "";
  return ` The platform is retrying (attempt ${failure.attempts} of ${failure.maxAttempts}).`;
}

export function workspaceFailureSentence(failure: WorkspaceFailure): string {
  return `${workspaceStepLabel(failure.kind)} failed. ${failure.error}${workspaceRetryNote(failure)}`;
}
