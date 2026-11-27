import type { Brand, FeatureId } from "api-server-api";

import { assistantFeatureRow } from "./assistant-feature-row.js";
import { damConnectionFeatureRow } from "./dam-connection-feature-row.js";
import { securityCheckFeatureRow } from "./security-check-feature-row.js";

export interface FeatureRow {
  label: string;
  description: string;
}

/* UNIT_BOUNDARY_DESCRIPTION: the name and the one-line promise of every feature, as its switch shows them in Settings. The rows that name the install or its assistant are built from the brand. */
export function featureRows(brand: Brand): Record<FeatureId, FeatureRow> {
  return {
    "advanced-connections": {
      label: "Advanced connections",
      description:
        "See the pre-release connection catalog: Google services, Spotify, YouTube and custom client credentials.",
    },
    processes: {
      label: "Processes panel",
      description:
        "See what runs in your agent, what keeps it awake, and what finished while you were away.",
    },
    "custom-avatars": {
      label: "Custom avatars",
      description:
        "Give an agent an emoji or an uploaded JPG or PNG as its avatar, in the UI and in Slack.",
    },
    environments: {
      label: "Environments and kept sub-agents",
      description:
        "Let your agents run sandboxes of their own and keep them: Environments for other people and agents to open, such as one per pull request, and sub-agents kept after their result, which your agent can enter, give more work, run in parallel and continue a conversation with. Both sleep when unused and expire.",
    },
    hermes: {
      label: "Hermes harness",
      description:
        "Offer Nous Research's Hermes Agent beside the other harnesses when you start a session, open a terminal or pick an agent's defaults, on agents whose image carries it.",
    },
    "github-enterprise-hosts": {
      label: "GitHub Enterprise hosts",
      description:
        "Pick which GitHub Enterprise host to connect to, and move a GitHub Enterprise sign-in to another host, on an install that offers more than one.",
    },
    "chat-network-approvals": {
      label: "Network approvals in the chat",
      description:
        "Allow or deny an agent's waiting network request in the open conversation, above the message box. Without it, approvals wait in the approvals list and in notifications.",
    },
    "one-time-tasks": {
      label: "One-time tasks",
      description:
        "Create a schedule that runs once, at a set time or right away, in a session of its own, and edit one before it runs.",
    },
    "mcp-tool-approval": {
      label: "Tool approval for MCP connections",
      description:
        "Choose for each agent what it may do with the tools of an MCP connection: call a tool at once, call it only after someone approves the call, or not at all.",
    },
    damConnection: damConnectionFeatureRow(brand),
    dambledore: assistantFeatureRow(brand),
    "security-check": securityCheckFeatureRow(brand),
  };
}
