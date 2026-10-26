import type { ProfileWithUsage } from "api-server-api";

/** UNIT_BOUNDARY_DESCRIPTION: what a new channel or schedule starts on (D91, D92): the first candidate the owner still holds — the profile of the agent's newest sibling, then the chat profile — else the owner's default for new agents. */
export function defaultProfileId(
  profiles: readonly ProfileWithUsage[],
  candidates: readonly (string | null | undefined)[],
): string | null {
  return (
    candidates.find((id) => id && profiles.some((p) => p.id === id)) ??
    profiles.find((p) => p.newAgentDefault)?.id ??
    null
  );
}
