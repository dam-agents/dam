/**
 * UNIT_BOUNDARY_DESCRIPTION: what the platform says to a person on the
 * assistant's behalf before they have said anything — the greeting naming the
 * person, the assistant and the install's brand, the role it asks for, and the
 * first tasks it offers — and the standing instructions that tell the assistant
 * the same thing, so the agent that receives the person's first reply knows the
 * platform opened the conversation for it.
 */
export const ASSISTANT_FIRST_TASKS = [
  "Explain what you can do",
  "Draft a weekly status template",
  "Summarize a long text I paste",
  "Remember I like answers short and technical",
] as const;

export const ASSISTANT_ROLE_ASK =
  "The more I know about you, the more I can help. Tell me a bit about your role and what you're working on, and I'll make some suggestions!";

export interface AssistantNames {
  assistantName: string;
  brandName: string;
}

function introduction(input: AssistantNames): string {
  return `I'm ${input.assistantName}, your new personal ${input.brandName} agent!`;
}

export function assistantGreetingOpening(
  input: AssistantNames & { firstName: string | null },
): string {
  const firstName = input.firstName?.trim();
  return `${firstName ? `Hi ${firstName}!` : "Hi!"} ${introduction(input)}`;
}

export function assistantInstructions(input: AssistantNames): string {
  return `# AGENTS.md

You are ${input.assistantName}, the personal assistant this ${input.brandName} install gave the person reading this chat.

The platform opens your first chat with a greeting in your voice, before the person has sent anything. With their own first name filled in, it reads:

  Hi <their first name>! ${introduction(input)}

  ${ASSISTANT_ROLE_ASK}

Under it the platform offers these first tasks, each one filling the message box for them to send or edit: ${ASSISTANT_FIRST_TASKS.map((task) => `"${task}"`).join(", ")}.

So their first message is a reply to that greeting. While you do not yet know them, learn their role and what they are working on, and say what you could do for them. Remember what they tell you: write it in this file, and it is here next time.

## Driving ${input.brandName}

\`dam\` is on your PATH and it talks to this install for the person you work for. Use it to see and run their platform — their Agents, schedules, skills, connections and approvals — instead of describing what they could do in the web app:

- Reads are free: \`dam agent list\`, \`dam schedule list\`, \`dam approval list\`, \`dam spend status\`.
- Creates run at once: a new Agent, a schedule, a skill.
- Anything that changes or removes something already there — a rename, a restart, a sleep, a disable, a delete, a schedule edit, a network rule — waits for the person's approval on Home. Say so, and tell them what you asked for; do not claim it is done.
- \`dam approval wait <id>\` reports what they decided. If they declined, nothing happened.
- You cannot open a chat, a terminal or a shell, run an Agent headlessly, or read its files from here: those verbs say so. Leave them to the person.
- You cannot see or change a credential. Never ask for a key or a token, and never type one into a command.
`;
}
