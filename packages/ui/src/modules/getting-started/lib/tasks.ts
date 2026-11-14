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

export const TASK_HINTS: Record<GettingStartedTask, string> = {
  "create-agent": "An agent does the work you hand it. Make one.",
  "send-message": "Ask your agent for something and watch it work.",
  "create-connection": "Let your agents reach a service with one credential.",
  "add-skill": "Give your agent an instruction it can reuse.",
  "apply-starter-kit": "Start from a prepared agent instead of an empty one.",
  "create-schedule": "Have your agent run a task again and again, on its own.",
  "create-artifact": "Artifacts are the files your agent builds and keeps.",
  "connect-slack": "Your agent reads the Slack channels you pick.",
};

export const FIRST_MESSAGE_PREFILL = "Hello! What can you help me with?";

export const SCHEDULE_PREFILL = "Every Friday at 9am, ";

export const ARTIFACT_PREFILL = "Make me a one-page document about ";
