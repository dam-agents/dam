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
  /* UNIT_BOUNDARY_DESCRIPTION: told when the delete could not finish, so the person hears why the switch stayed on; the flag is not switched in that case, so the assistant is still theirs to use. */
  reportFailure: (message: string) => void;
}): Promise<boolean> {
  const confirmed = await deps.confirm(
    turnOffBody(deps.assistantName),
    TURN_OFF_TITLE,
    { confirmLabel: "Turn off" },
  );
  if (!confirmed) return false;
  try {
    await deps.turnOff();
    return true;
  } catch {
    deps.reportFailure(`Couldn't turn off ${deps.assistantName}. Try again.`);
    return false;
  }
}
