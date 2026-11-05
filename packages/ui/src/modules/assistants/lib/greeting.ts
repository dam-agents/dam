import {
  type AgentKind,
  ASSISTANT_FIRST_TASKS,
  ASSISTANT_ROLE_ASK,
  assistantGreetingOpening,
} from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting an unused assistant opens its chat
 * with, as the platform renders it: its introduction naming the person and the
 * install's brand, the role it asks for, the first tasks it offers — the text
 * its standing instructions already tell the agent it wrote — and the one of
 * them the empty composer shows as an example.
 */
export const GREETING_SUGGESTIONS = ASSISTANT_FIRST_TASKS;

export const GREETING_PLACEHOLDER = GREETING_SUGGESTIONS[3];

export interface GreetingCopy {
  assistantName: string;
  paragraphs: readonly string[];
  suggestions: readonly string[];
  placeholder: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this chat shows the greeting: the person's
 * own assistant, with the feature on for them, which the server says has never
 * been used. It is the row's mark alone that decides — not how many sessions the
 * Agent holds — so a New chat opens with the greeting even after older sessions,
 * and it is gone the moment a sent message marks the assistant used, until the
 * person resets their onboarding.
 */
export function greetingShown(input: {
  kind: AgentKind | null;
  assistantOn: boolean;
  assistantId: string | null;
  selectedAgent: string | null;
  used: boolean | undefined;
}): boolean {
  return (
    input.kind === "assistant" &&
    input.assistantOn &&
    input.used === false &&
    input.assistantId !== null &&
    input.selectedAgent === input.assistantId
  );
}

export function greetingCopy(input: {
  firstName: string | null;
  assistantName: string;
  brandName: string;
}): GreetingCopy {
  return {
    assistantName: input.assistantName,
    paragraphs: [assistantGreetingOpening(input), ASSISTANT_ROLE_ASK],
    suggestions: GREETING_SUGGESTIONS,
    placeholder: GREETING_PLACEHOLDER,
  };
}
