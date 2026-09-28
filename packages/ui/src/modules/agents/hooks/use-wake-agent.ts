import { useWakeAgentMutation } from "../api/mutations.js";
import { useRestartingAction } from "./use-restarting-action.js";

export function useWakeAgent() {
  const { mutate, isPending } = useWakeAgentMutation();
  const wake = useRestartingAction(mutate);

  return { wake, isPending };
}
