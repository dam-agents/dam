import { useStore } from "../../../store.js";
import { useGrantProvider } from "../api/session-pair.js";
import type { ModelGroup } from "../lib/catalog-groups.js";
import { pairSummary } from "../lib/session-settings.js";

/** UNIT_BOUNDARY_DESCRIPTION: a picker's popover stays open while a dialog it opened, such as the connect warning, is up: the dialog takes focus and clicks outside the popover, and a confirm or a cancel returns to the open picker, on the screen it was on, with focus back on the row that asked. */
export function keepOpenWhileDialog(event: Event): void {
  if (useStore.getState().dialog?.open) event.preventDefault();
}

/** UNIT_BOUNDARY_DESCRIPTION: the one warning before a provider is connected to an agent from a pick, a model's or a profile's: the agent can then use all of the provider's models. */
export function useConfirmConnect() {
  const showConfirm = useStore((s) => s.showConfirm);
  return (provider: string, model: string): Promise<boolean> =>
    showConfirm(
      `This agent can then use every model ${provider} offers, not only ${pairSummary(model, {})}.`,
      `Connect ${provider} to this agent?`,
      { confirmLabel: "Connect" },
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a pick from a provider the agent is not
 * connected to asks first, since connecting it lets the agent use every model
 * that provider offers. Confirmed, the provider is granted and the pick
 * applied; cancelled, or a grant that fails, changes nothing.
 */
export function useConnectOnPick(agentId: string | null) {
  const confirm = useConfirmConnect();
  const { grant } = useGrantProvider(agentId);
  return (group: ModelGroup, model: string, apply: () => void): void => {
    if (group.attached) return apply();
    void confirm(group.displayName, model).then(async (ok) => {
      if (ok && (await grant(group.connectionId))) apply();
    });
  };
}
