import type { WebSearchVerdict } from "api-server-api";

export type WebSearchRuleChoice = "ask" | WebSearchVerdict;

export const WEB_SEARCH_RULE_CHOICES: readonly {
  value: WebSearchRuleChoice;
  label: string;
  hint: string;
}[] = [
  {
    value: "ask",
    label: "Ask each time",
    hint: "Each search waits for your answer in the chat and on Home. Scheduled and channel runs refuse it.",
  },
  {
    value: "allow",
    label: "Always allow",
    hint: "Every search goes ahead without asking, whatever the query, in every run.",
  },
  {
    value: "deny",
    label: "Always deny",
    hint: "Every search is refused without asking. The agent gets a failed search and can fetch pages instead.",
  },
];

export function ruleChoiceOf(
  verdict: WebSearchVerdict | undefined,
): WebSearchRuleChoice {
  return verdict ?? "ask";
}

export function verdictOfChoice(
  choice: WebSearchRuleChoice,
): WebSearchVerdict | null {
  return choice === "ask" ? null : choice;
}
