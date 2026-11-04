/**
 * UNIT_BOUNDARY_DESCRIPTION: the first thing an unused assistant says, before
 * the owner has sent anything: who it is and the brand it belongs to, the ask to
 * hear about the owner's role, and tasks that need neither a connection nor any
 * personal context — clickable into the composer, and offered to the agent as
 * the context of the owner's first turn, since the platform wrote that turn's
 * opening rather than the owner.
 */
export const GREETING_SUGGESTIONS = [
  "Explain what you can do",
  "Draft a weekly status template",
  "Summarize a long text I paste",
  "Remember I like answers short and technical",
] as const;

export const GREETING_PLACEHOLDER = GREETING_SUGGESTIONS[3];

const CONTEXT_TAG = "assistant-greeting";

export interface GreetingCopy {
  assistantName: string;
  paragraphs: readonly string[];
  suggestions: readonly string[];
  placeholder: string;
  context: string;
}

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

export function greetingPrompt(text: string, context: string): string {
  return text ? `${text}\n\n${context}` : context;
}

export function greetingCopy(input: {
  firstName: string | null;
  assistantName: string;
  brandName: string;
}): GreetingCopy {
  const name = input.firstName?.trim();
  const paragraphs = [
    `${name ? `Hi ${name}!` : "Hi!"} I'm ${input.assistantName}, your new personal ${input.brandName} agent!`,
    "The more I know about you, the more I can help. Tell me a bit about your role and what you're working on, and I'll make some suggestions!",
  ];
  return {
    assistantName: input.assistantName,
    paragraphs,
    suggestions: GREETING_SUGGESTIONS,
    placeholder: GREETING_PLACEHOLDER,
    context: [
      `<${CONTEXT_TAG}>`,
      `The platform showed this greeting in the chat, in your voice, before the first message from the owner of this agent:`,
      "",
      ...paragraphs.map((paragraph) => `> ${paragraph}`),
      "",
      `Under it, the platform offered these tasks as chips that fill the composer without sending: ${GREETING_SUGGESTIONS.map((task) => `"${task}"`).join(", ")}.`,
      "The message below is their first reply to it: one of those tasks, or what they chose to tell you themselves.",
      `</${CONTEXT_TAG}>`,
    ].join("\n"),
  };
}
