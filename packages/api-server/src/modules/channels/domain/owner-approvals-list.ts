import { questionCard, type OwnerQuestionView } from "./owner-question-card.js";
import {
  SLACK_MAX_BLOCKS,
  cut,
  hostRow,
  plainText,
  rowBlocks,
  type CardRow,
  type SlackBlock,
} from "./owner-request-cards.js";

const LIST_ARGUMENTS_MAX = 500;

export type ApprovalsListEntry =
  | { kind: "host"; rows: CardRow[] }
  | { kind: "request"; row: CardRow }
  | { kind: "question"; view: OwnerQuestionView };

export interface ApprovalsListAgent {
  name: string;
  entries: ApprovalsListEntry[];
}

function requestsOf(entry: ApprovalsListEntry): number {
  return entry.kind === "host" ? entry.rows.length : 1;
}

function entryBlocks(entry: ApprovalsListEntry, appUrl: string): SlackBlock[] {
  if (entry.kind === "host") return hostRow(entry.rows, appUrl);
  if (entry.kind === "request")
    return rowBlocks(entry.row, appUrl, LIST_ARGUMENTS_MAX);
  return questionCard(entry.view, { inList: true }).blocks;
}

function waitLine(count: number): string {
  if (count === 0) return "Nothing waits for you.";
  return count === 1
    ? "1 request waits for you."
    : `${String(count)} requests wait for you.`;
}

// UNIT_BOUNDARY_DESCRIPTION: the private list `/<command> approvals` answers with: how many requests wait for the caller, then each agent of theirs with its requests, newest first, in the form its card gives it: a network host or the web searches as one row, an MCP call, a sub-agent's launch rule or question with its buttons or form, and any other type as a summary with "Open in app". The list stops before Slack's limit of 50 blocks a message and says how many requests more wait in the app. With the cards off, it says how to turn them back on.
export function approvalsList(input: {
  agents: readonly ApprovalsListAgent[];
  appUrl: string;
  cardsOff: { onCommand: string } | null;
}): { text: string; blocks: SlackBlock[] } {
  const total = input.agents
    .flatMap((agent) => agent.entries)
    .reduce((sum, entry) => sum + requestsOf(entry), 0);
  const head = waitLine(total);
  const foot: SlackBlock[] = input.cardsOff
    ? [
        {
          type: "context",
          elements: [
            plainText(
              `Cards are off, so no request comes to your DM. Run ${input.cardsOff.onCommand} to turn them on.`,
            ),
          ],
        },
      ]
    : [];
  const budget = SLACK_MAX_BLOCKS - 1 - foot.length - 1;
  const body: SlackBlock[] = [];
  let shown = 0;
  let full = false;
  for (const agent of input.agents) {
    const heading: SlackBlock = {
      type: "header",
      text: plainText(cut(agent.name, 150)),
    };
    let headed = false;
    for (const entry of agent.entries) {
      const blocks = [
        ...(headed ? [] : [heading]),
        { type: "divider" },
        ...entryBlocks(entry, input.appUrl),
      ];
      full = body.length + blocks.length > budget;
      if (full) break;
      body.push(...blocks);
      headed = true;
      shown += requestsOf(entry);
    }
    if (full) break;
  }
  const more = total - shown;
  return {
    text: head,
    blocks: [
      { type: "section", text: plainText(head) },
      ...body,
      ...(more > 0
        ? [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `…and ${String(more)} more in the <${input.appUrl}|app>`,
                },
              ],
            },
          ]
        : []),
      ...foot,
    ],
  };
}
