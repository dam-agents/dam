import type { AgentAccess, AgentPermission } from "api-server-api";

import type { SandboxSection } from "../../platform/lib/routes.js";

const SECTION_PERMISSIONS: Record<SandboxSection, readonly AgentPermission[]> =
  {
    setup: ["settings", "lifecycle", "delete"],
    people: ["editors"],
    providers: ["connections", "spendLimits", "settings"],
    connections: ["connections", "credentialInjection"],
    network: ["egressRules"],
    environment: ["envVars"],
    channels: ["channels"],
    "chat-forms": ["chatForms"],
    skills: ["skills", "skillSources", "skillPublish"],
    schedules: ["schedules"],
    environments: ["environments"],
    usage: ["spendLimits"],
  };

export function holds(
  access: AgentAccess,
  permission: AgentPermission,
): boolean {
  return access.permissions.includes(permission);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a section of an Agent's page is locked
 * for the viewer: they hold none of the Agent Permissions it needs. A section
 * where they hold some of them is not locked; it disables only the controls
 * they lack.
 */
export function isLockedSection(
  access: AgentAccess,
  section: SandboxSection,
): boolean {
  return !SECTION_PERMISSIONS[section].some((p) => holds(access, p));
}

export function ownerName(access: AgentAccess): string {
  return access.role === "editor"
    ? (access.ownerEmail ?? "a former user")
    : "you";
}
