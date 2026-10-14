import { useWakeAgentMutation } from "../api/mutations.js";
import { useRestartingAction } from "./use-restarting-action.js";

export function useWakeAgent() {
  const { mutateAsync, isPending } = useWakeAgentMutation();
  const wake = useRestartingAction(mutateAsync);

  return { wake, isPending };
}
