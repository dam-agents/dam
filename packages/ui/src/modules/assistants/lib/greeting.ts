import {
  ASSISTANT_LEARN_LINE,
  ASSISTANT_SETTINGS_LINK,
  ASSISTANT_SETTINGS_SENTENCE,
  assistantGreetingOpening,
  type AssistantIdea,
  assistantIdeas,
} from "api-server-api";

import type { Message } from "../../../types.js";

/* UNIT_BOUNDARY_DESCRIPTION: the composer under the greeting hints what the box takes — a message to this assistant by name, as the design does — rather than the first idea's text, which belongs on the pill. */

export interface GreetingCopy {
  assistantName: string;
  opening: string;
  learn: string;
  settingsPrefix: string;
  settingsLink: string;
  ideas: readonly AssistantIdea[];
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
  assistantOn: boolean;
  assistantId: string | null;
  selectedAgent: string | null;
  used: boolean | undefined;
}): boolean {
  return (
    input.assistantOn &&
    input.used === false &&
    input.assistantId !== null &&
    input.selectedAgent === input.assistantId
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a chat is the assistant's own, which outlives
 * the greeting: the feature is on for the person and the record names the Agent
 * this chat belongs to, whatever the record says about its use.
 */
export function isAssistantChat(input: {
  assistantOn: boolean;
  assistantId: string | null;
  selectedAgent: string | null;
}): boolean {
  return (
    input.assistantOn &&
    input.assistantId !== null &&
    input.selectedAgent === input.assistantId
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting's words. The opening names the person
 * and the assistant, the sentence after it says where the provider is changed,
 * and the ideas are the assistant's five kinds of first task, each labelled so the
 * person sees what it would be learning.
 */
export function greetingCopy(input: {
  firstName: string | null;
  assistantName: string;
  brandName: string;
}): GreetingCopy {
  return {
    assistantName: input.assistantName,
    opening: assistantGreetingOpening(input),
    learn: ASSISTANT_LEARN_LINE,
    settingsPrefix: ASSISTANT_SETTINGS_SENTENCE,
    settingsLink: ASSISTANT_SETTINGS_LINK,
    ideas: assistantIdeas(input.brandName),
    placeholder: `Message ${input.assistantName}`,
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: the ideas "Try something new" offers in a chat: all of them but the one the chat started from, which is the idea whose text is in the chat's first message from the person, as a click on its chip puts it there. A long chat whose start is not loaded reads its first loaded message instead, which at worst hides an idea the person picked later in that chat. */
export function ideasNotStarted(
  ideas: readonly AssistantIdea[],
  messages: readonly Message[],
): readonly AssistantIdea[] {
  const first = messages
    .find((m) => m.role === "user")
    ?.parts.flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("");
  return ideas.filter((idea) => !first?.includes(idea.text.trim()));
}
