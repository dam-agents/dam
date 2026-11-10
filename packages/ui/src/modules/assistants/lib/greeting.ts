import {
  ASSISTANT_IDEAS,
  ASSISTANT_LEARN_LINE,
  ASSISTANT_PROVIDER_LINE,
  ASSISTANT_PROVIDER_NEUTRAL_LINE,
  ASSISTANT_SETTINGS_LINK,
  ASSISTANT_SETTINGS_SENTENCE,
  assistantGreetingOpening,
  type AssistantIdea,
  assistantIdeas,
} from "api-server-api";

export const GREETING_PLACEHOLDER = `${ASSISTANT_IDEAS[0]!.label}: ${ASSISTANT_IDEAS[0]!.text}`;

export interface GreetingCopy {
  assistantName: string;
  opening: string;
  provider: string;
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
 * UNIT_BOUNDARY_DESCRIPTION: the greeting's words. The opening names the person
 * and the assistant, the provider line names the one the agent runs on only when
 * it is the install's CurveBender (and otherwise says where to change it), and
 * the ideas are the assistant's five kinds of first task, each labelled so the
 * person sees what it would be learning.
 */
export function greetingCopy(input: {
  firstName: string | null;
  assistantName: string;
  brandName: string;
  provider: "curve-bender" | "other" | null;
}): GreetingCopy {
  return {
    assistantName: input.assistantName,
    opening: assistantGreetingOpening(input),
    provider:
      input.provider === "curve-bender"
        ? ASSISTANT_PROVIDER_LINE
        : ASSISTANT_PROVIDER_NEUTRAL_LINE,
    learn: ASSISTANT_LEARN_LINE,
    settingsPrefix: ASSISTANT_SETTINGS_SENTENCE,
    settingsLink: ASSISTANT_SETTINGS_LINK,
    ideas: assistantIdeas(input.brandName),
    placeholder: GREETING_PLACEHOLDER,
  };
}

/* UNIT_BOUNDARY_DESCRIPTION: which provider line the greeting uses: the CurveBender sentence only when the Agent's preferred provider Connection is one of CurveBender's two templates, so a provider it does not run on is never named. */
export function providerLineFor(
  templateId: string | undefined,
): "curve-bender" | "other" | null {
  if (templateId === undefined) return null;
  return templateId === "curve-bender" ||
    templateId === "curve-bender-deployment"
    ? "curve-bender"
    : "other";
}
