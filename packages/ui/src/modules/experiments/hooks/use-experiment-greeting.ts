import { skipToken, useQuery } from "@tanstack/react-query";
import { EXPERIMENT_SKILL_NAME } from "api-server-api";

import { trpc } from "../../../trpc.js";
import { useAgentRunState } from "../../agents/api/queries.js";
import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";

/** The onboarding command the authoring kit installs alongside the skill. */
const ONBOARD_COMMAND = "/experiment-onboard";

const SETUP_POLL_MS = 3000;
/** ~2 minutes. An Install Command that hasn't landed by then failed or is never
 *  coming; stop rather than poll for as long as the tab is open. Giving up leaves
 *  the chat un-greeted, which beats greeting with a command that doesn't exist. */
const SETUP_POLL_MAX_ATTEMPTS = 40;

interface SkillsStateShape {
  standalone: { name: string }[];
  installed: { name: string }[];
}

/** Whether the authoring kit has landed — the skill is copied last, so its
 *  presence implies the command too.
 *
 *  Not `useSkillsState`: that deliberately never polls, because a poll can land
 *  in the reconcile settle window and revert an in-flight toggle (#2775). Safe
 *  here — nothing is toggled on a sandbox this new, and this is bounded. */
function useExperimentSetupReady(agentId: string | null, enabled: boolean) {
  const { data } = useQuery({
    ...trpc.skills.state.queryOptions(
      agentId && enabled ? { agentId } : skipToken,
    ),
    retry: false,
    refetchInterval: (query) =>
      hasSkill(query.state.data) ||
      query.state.dataUpdateCount >= SETUP_POLL_MAX_ATTEMPTS
        ? false
        : SETUP_POLL_MS,
    refetchOnWindowFocus: false,
  });
  return hasSkill(data);
}

/** Both buckets: a copied skill is untracked so it reports as `standalone`, but
 *  anything that tracks it moves it to `installed` and the gate means the same
 *  thing either way — is it on disk. */
function hasSkill(state: SkillsStateShape | undefined) {
  if (!state) return false;
  return [...state.standalone, ...state.installed].some(
    (skill) => skill.name === EXPERIMENT_SKILL_NAME,
  );
}

/** Greet the user on a fresh experiment sandbox, once its authoring skill is in. */
export function useExperimentGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady">,
) {
  // Match the greeting's own arming conditions, `running` included: a stopped or
  // hibernated agent reports no standalone skills at all, so probing one would
  // never resolve.
  const runState = useAgentRunState(opts.agentId);
  const probing =
    opts.active && opts.idle && opts.agentId !== null && runState === "running";
  const setupReady = useExperimentSetupReady(opts.agentId, probing);
  useAgentGreeting({ ...opts, command: ONBOARD_COMMAND, setupReady });
}
