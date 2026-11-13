import {
  A2UI_CHAT_EXTENSION_ID,
  chatFormCapabilities,
} from "./capabilities.js";
import type { ChatFormCheck } from "./check.js";
import {
  readChatFormPreferences,
  type ChatFormPreferences,
} from "./preferences.js";
import { findRendererBlocks } from "./renderer-blocks.js";
import { A2UI_VERSION } from "./schema.js";

export const CHAT_FORM_CHECK_TAG = "chat-form-check";

export const MAX_CHAT_FORM_FIXES = 2;

const ATTEMPT_RE = new RegExp(`<${CHAT_FORM_CHECK_TAG} attempt="(\\d+)"`);

export interface ChatFormAnnouncement {
  preferences?: ChatFormPreferences;
  fixAttempt: number;
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source.trim());
  } catch {
    return undefined;
  }
}

function announcedPreferences(body: string): ChatFormPreferences | undefined {
  const parsed = parseJson(body);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const extension = (parsed as Record<string, unknown>)[A2UI_CHAT_EXTENSION_ID];
  if (typeof extension !== "object" || extension === null) return undefined;
  const { preferences } = extension as { preferences?: unknown };
  return preferences === undefined
    ? undefined
    : readChatFormPreferences(preferences);
}

export function chatFormFixAttemptOf(prompt: string): number | null {
  const attempt = ATTEMPT_RE.exec(prompt)?.[1];
  return attempt === undefined ? null : Number(attempt);
}

// UNIT_BOUNDARY_DESCRIPTION: reads a prompt the way the runtime decides whether to check the reply to it: only a prompt that announces the renderer capabilities lets the agent send a form, and a prompt the platform sent back with form errors names its attempt, so the count needs no state that a restart would lose.
export function chatFormAnnouncementOf(
  prompt: string,
): ChatFormAnnouncement | null {
  const capabilities = findRendererBlocks(prompt).find(
    (block) => block.tag === "capabilities",
  );
  if (capabilities === undefined) return null;
  const preferences = announcedPreferences(capabilities.body);
  return {
    ...(preferences !== undefined && { preferences }),
    fixAttempt: chatFormFixAttemptOf(prompt) ?? 0,
  };
}

function errorMessage(problem: ChatFormCheck["problems"][number]): string {
  const message = {
    version: A2UI_VERSION,
    error: { ...problem, surfaceId: problem.surfaceId ?? "(unknown)" },
  };
  return `<a2ui-message>\n${JSON.stringify(message)}\n</a2ui-message>`;
}

export function chatFormFixPrompt(
  check: ChatFormCheck,
  attempt: number,
  preferences?: ChatFormPreferences,
): string {
  const errors = check.problems.map(errorMessage);
  const body =
    attempt > MAX_CHAT_FORM_FIXES
      ? [
          "The chat form in your last reply failed the platform's check again, so the user was not shown it.",
          "Ask the same question again in plain text, with no <a2ui-json> block.",
          "Do not mention the failed form.",
        ]
      : [
          "The platform checked the chat form in your last reply and the chat cannot show it, so the user was not shown it.",
          "The renderer error messages below say what is wrong.",
          "Send the whole reply again with the form fixed.",
          "None of its surfaces reached the user, so create each surface again with createSurface; do not update or delete them.",
          "Do not mention the failed form or this check.",
          ...errors,
          chatFormCapabilities(preferences),
        ];
  return [
    `<${CHAT_FORM_CHECK_TAG} attempt="${String(attempt)}">`,
    ...body,
    `</${CHAT_FORM_CHECK_TAG}>`,
  ].join("\n");
}
