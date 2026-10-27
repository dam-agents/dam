/** UNIT_BOUNDARY_DESCRIPTION: the sections of an agent's page, which the UI routes and the links the server writes into a reply both name, so a link never lands on Not found. */
export const SANDBOX_SECTIONS = [
  "setup",
  "people",
  "providers",
  "connections",
  "network",
  "environment",
  "channels",
  "chat-forms",
  "skills",
  "schedules",
  "environments",
  "usage",
] as const;

export type SandboxSection = (typeof SANDBOX_SECTIONS)[number];

export const agentPageUrl = (
  uiBaseUrl: string,
  agentId: string,
  section: SandboxSection,
): string => `${uiBaseUrl}/sandboxes/${agentId}/${section}`;
