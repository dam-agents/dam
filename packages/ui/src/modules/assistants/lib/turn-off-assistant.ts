/**
 * UNIT_BOUNDARY_DESCRIPTION: The words and the one step of turning the assistant
 * off for one person: the switch is a delete, so it asks first — naming the
 * install's own assistant — and only a confirmation calls the flag change that
 * deletes the assistant and its data. Cancel leaves the switch on and changes
 * nothing.
 */
export const TURN_OFF_TITLE = "Turn off your assistant?";

export function turnOffBody(assistantName: string): string {
  return `Turning off ${assistantName} deletes your assistant and its sessions and files.`;
}

export async function runTurnOffAssistant(deps: {
  assistantName: string;
  confirm: (
    body: string,
    title: string,
    options: { confirmLabel: string },
  ) => Promise<boolean>;
  turnOff: () => Promise<unknown>;
}): Promise<boolean> {
  const confirmed = await deps.confirm(
    turnOffBody(deps.assistantName),
    TURN_OFF_TITLE,
    { confirmLabel: "Turn off" },
  );
  if (!confirmed) return false;
  await deps.turnOff();
  return true;
}
