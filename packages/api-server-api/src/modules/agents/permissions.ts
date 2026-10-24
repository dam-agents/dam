import { z } from "zod";

export const AGENT_PERMISSIONS = [
  "view",
  "settings",
  "envVars",
  "secretRef",
  "credentialInjection",
  "lifecycle",
  "connections",
  "spendLimits",
  "egressRules",
  "skills",
  "skillSources",
  "skillPublish",
  "schedules",
  "chatForms",
  "environments",
  "channels",
  "sessions",
  "editors",
  "delete",
] as const;

export const agentPermissionSchema = z.enum(AGENT_PERMISSIONS);

export type AgentPermission = z.infer<typeof agentPermissionSchema>;

export type AgentTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "schedules"; scheduleIds: readonly string[] }
  | { kind: "egressRule"; ruleId: string }
  | { kind: "environment"; environmentId: string };
