/**
 * UNIT_BOUNDARY_DESCRIPTION: The one-time news that provisioning an assistant
 * renamed another of the owner's Agents to make room for the reserved name. It
 * names both names, and stays until the owner dismisses it.
 */
export interface AssistantNotice {
  renamedFrom: string;
  renamedTo: string;
}

export interface AssistantsService {
  notice(): Promise<AssistantNotice | null>;
  dismissNotice(): Promise<void>;
}
