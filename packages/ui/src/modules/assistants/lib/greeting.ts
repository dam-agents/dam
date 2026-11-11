import {
  ASSISTANT_LEARN_LINE,
  ASSISTANT_PROVIDER_LINE,
  ASSISTANT_SETTINGS_LINK,
  ASSISTANT_SETTINGS_SENTENCE,
  assistantGreetingOpening,
  type AssistantIdea,
  assistantIdeas,
  providerTypeForTemplateId,
} from "api-server-api";

/* UNIT_BOUNDARY_DESCRIPTION: the composer under the greeting hints what the box takes — a message to this assistant by name, as the design does — rather than the first idea's text, which belongs on the pill. */

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
    /* UNIT_BOUNDARY_DESCRIPTION: no provider sentence at all until the Agent's own Connection says CurveBender, so the line about switching stands alone rather than being said twice. */
    provider: input.provider === "curve-bender" ? ASSISTANT_PROVIDER_LINE : "",
    learn: ASSISTANT_LEARN_LINE,
    settingsPrefix: ASSISTANT_SETTINGS_SENTENCE,
    settingsLink: ASSISTANT_SETTINGS_LINK,
    ideas: assistantIdeas(input.brandName),
    placeholder: `Message ${input.assistantName}`,
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

/* UNIT_BOUNDARY_DESCRIPTION: the template of the provider Connection the Agent runs on — of the Connections on provider templates only, the one the person marked preferred and otherwise the first in that order — so the greeting names the provider it actually has, never an app Connection that happens to be listed before it. */
export function preferredProviderTemplate(
  data:
    | {
        connections: readonly {
          preferred: boolean;
          connection?: { templateId: string };
        }[];
      }
    | undefined,
): string | undefined {
  if (!data) return undefined;
  const providers = data.connections.filter(
    (c) =>
      c.connection !== undefined &&
      providerTypeForTemplateId(c.connection.templateId) !== null,
  );
  const chosen = providers.find((c) => c.preferred) ?? providers[0];
  return chosen?.connection?.templateId;
}
