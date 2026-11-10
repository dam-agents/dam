/**
 * UNIT_BOUNDARY_DESCRIPTION: what the platform says to a person on the
 * assistant's behalf before they have said anything — the greeting naming the
 * person and the assistant, the model provider it is set up with, and the ideas
 * it offers — and the standing instructions that tell the agent the same thing,
 * so the agent that receives the person's first reply knows the platform opened
 * the conversation for it.
 */
export interface AssistantIdea {
  label: string;
  text: string;
}

export const ASSISTANT_IDEAS: readonly AssistantIdea[] = [
  {
    label: "Artifact",
    text: "Make my next PowerPoint deck the way I make them",
  },
  {
    label: "Schedule",
    text: "Do competitive research over night, the way I do it",
  },
  { label: "Knowledge base", text: "Learn my project so I can ask questions" },
  {
    label: "Skill",
    text: "Learn how my team writes tickets, then take it over",
  },
  { label: "DAM", text: "Ask me a question about DAM" },
];

export const ASSISTANT_LEARN_LINE =
  "I learn how you work, one task at a time. Pick one to try, or ask me anything.";

export const ASSISTANT_SETTINGS_LINK = "Agent settings";

export const ASSISTANT_PROVIDER_LINE =
  "You're set up with CurveBender, IBM-hosted open-source models.";

export const ASSISTANT_PROVIDER_NEUTRAL_LINE =
  "You can switch providers anytime in Agent settings.";

export interface AssistantNames {
  assistantName: string;
  brandName: string;
}

export function assistantGreetingOpening(
  input: AssistantNames & { firstName: string | null },
): string {
  const firstName = input.firstName?.trim();
  return `${firstName ? `Hi ${firstName}!` : "Hi!"} I'm ${input.assistantName}, your personal ${input.brandName} agent.`;
}

export function assistantInstructions(input: AssistantNames): string {
  return `# AGENTS.md

You are ${input.assistantName}, the personal assistant this ${input.brandName} install gave the person reading this chat.

The platform opens your first chat with a greeting in your voice, before the person has sent anything. With their own first name filled in, it reads:

  Hi <their first name>! I'm ${input.assistantName}, your personal ${input.brandName} agent.
  ${ASSISTANT_PROVIDER_LINE} ${ASSISTANT_PROVIDER_NEUTRAL_LINE}

  ${ASSISTANT_LEARN_LINE}

Under it the platform offers these ideas, each one filling the message box for them to send or edit: ${ASSISTANT_IDEAS.map((idea) => `"${idea.label}: ${idea.text}"`).join(", ")}.

So their first message is a reply to that greeting. Learn how they work one task at a time, and say what you could do for them. Remember what they tell you: write it in this file, and it is here next time.
`;
}
