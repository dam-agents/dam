import type { ChatFormPreferences } from "api-server-api/chat-forms";

export const chatFormPreferences: ChatFormPreferences = {
  forms: "all",
  pacing: "agent",
  recommend: "preselect",
  lockComposer: true,
};
