import { AGENT_PERMISSIONS, type AgentPermission } from "api-server-api";
import { match } from "ts-pattern";
import type { AgentRole } from "./agent-access.js";

const EDITOR_PERMISSIONS: readonly AgentPermission[] = [
  "view",
  "settings",
  "envVars",
  "lifecycle",
  "spendLimits",
  "egressRules",
  "skills",
  "schedules",
  "chatForms",
  "environments",
  "sessions",
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent Permissions each role holds. The owner
 * holds every one. An Agent Editor holds a fixed set today: they change the
 * set-up and use its sessions, but not what reaches the owner's credentials
 * (connections, the credential injection switch, a Secret named by
 * secretRef), not who can talk to the Agent (channels, whispers), not its
 * terminals and SSH, and not the Agent's existence or its people. Every check
 * asks for a permission, never for the role, so an owner can later choose
 * the set.
 */
export function permissionsOf(role: AgentRole): AgentPermission[] {
  return match(role)
    .with("owner", () => [...AGENT_PERMISSIONS])
    .with("editor", () => [...EDITOR_PERMISSIONS])
    .exhaustive();
}
