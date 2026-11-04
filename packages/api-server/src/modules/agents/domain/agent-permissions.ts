import {
  AGENT_PERMISSIONS,
  type AgentKind,
  type AgentPermission,
} from "api-server-api";
import { match } from "ts-pattern";
import type { AgentRole } from "./agent-access.js";

const EDITOR_PERMISSIONS: readonly AgentPermission[] = [
  "view",
  "settings",
  "envVars",
  "lifecycle",
  "disable",
  "spendLimits",
  "egressRules",
  "skills",
  "schedules",
  "chatForms",
  "environments",
  "sessions",
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the owner may not do to the assistant. The
 * assistant is the one Agent the platform provisions for a person, so it stays
 * theirs alone and stays on: no delete, no other editors, no disabling, and no
 * binding it to a conversation. Everything else about it is the owner's, and
 * every other kind keeps every permission.
 */
const ASSISTANT_REFUSED: readonly AgentPermission[] = [
  "delete",
  "editors",
  "disable",
  "channelBinding",
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent Permissions each role holds. The owner
 * holds every one, except on the assistant, which keeps every permission but
 * the ones that would remove it, hand it to someone else, put it to sleep for
 * good or attach it to a conversation. An Agent Editor holds a fixed set
 * today: they change the set-up and use its sessions, but not what reaches the
 * owner's credentials (connections, the credential injection switch, a Secret
 * named by secretRef), not who can talk to the Agent (channels, whispers), not
 * its terminals and SSH, and not the Agent's existence or its people. Every
 * check asks for a permission, never for the role, so an owner can later
 * choose the set.
 */
export function permissionsOf(
  role: AgentRole,
  kind?: AgentKind,
): AgentPermission[] {
  return match(role)
    .with("owner", () =>
      kind === "assistant"
        ? AGENT_PERMISSIONS.filter((p) => !ASSISTANT_REFUSED.includes(p))
        : [...AGENT_PERMISSIONS],
    )
    .with("editor", () => [...EDITOR_PERMISSIONS])
    .exhaustive();
}
