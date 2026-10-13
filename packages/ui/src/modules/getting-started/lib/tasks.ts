import type { GettingStartedTask } from "api-server-api";

export const TASK_TITLES: Record<GettingStartedTask, string> = {
  "create-agent": "Create your first agent",
  "send-message": "Send your agent a message",
  "create-connection": "Create a connection",
  "add-skill": "Add a skill",
  "apply-starter-kit": "Try a starter kit",
  "create-schedule": "Schedule a recurring task",
  "create-artifact": "Create an artifact",
  "connect-slack": "Use your agent in Slack",
};

export const FIRST_MESSAGE_PREFILL = "Hello! What can you help me with?";

export const SCHEDULE_PREFILL = "Every Friday at 9am, ";
