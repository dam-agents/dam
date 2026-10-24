import {
  type ChatFormPreferences,
  DEFAULT_CHAT_FORM_PREFERENCES,
} from "api-server-api/chat-forms";

/**
 * UNIT_BOUNDARY_DESCRIPTION: which settings the chat announces to an Agent:
 * with the Unified right toolbar experiment on, where no surface edits them,
 * the built-in defaults, so forms behave the same for every Agent of that
 * install; everywhere else the Agent's own stored settings.
 */
export function chatFormPreferencesFor(
  rightToolbar: boolean,
  stored: ChatFormPreferences | undefined,
): ChatFormPreferences | undefined {
  return rightToolbar ? DEFAULT_CHAT_FORM_PREFERENCES : stored;
}
