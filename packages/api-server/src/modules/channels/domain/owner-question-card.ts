import {
  OWNER_REQUEST_ACTION_PREFIX,
  cut,
  plainText,
  type SlackBlock,
} from "./owner-request-cards.js";

export const OWNER_QUESTION_SEND_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}send-answer`;
export const OWNER_QUESTION_CHOICE_BLOCK = "owner-question-choice";
export const OWNER_QUESTION_CHOICE_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}question-choice`;
export const OWNER_QUESTION_TEXT_BLOCK = "owner-question-text";
export const OWNER_QUESTION_TEXT_ACTION = `${OWNER_REQUEST_ACTION_PREFIX}question-text`;

const OPTION_LABEL_MAX = 75;
const OTHER = "other";
const TEXT_MAX = 2900;
const LIST_TEXT_MAX = 1000;

export const ANSWER_HINT = "Pick an option or write an answer.";

// UNIT_BOUNDARY_DESCRIPTION: what a question card shows of one sub-agent question: who asks under which Driver, the question, its options and default, until when it waits, and how it ended, with whether the owner answered it on this card.
export interface OwnerQuestionView {
  runId: string;
  subAgentName: string;
  driverName: string;
  question: string;
  options: readonly string[];
  defaultOption: string;
  answerBy: string;
  status: "asking" | "answered" | "stopped";
  answer: { text: string; by: "owner" | "default" } | null;
  answeredHere: boolean;
}

function slackDate(iso: string): string {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return `<!date^${seconds}^{date_short_pretty} {time}|${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC>`;
}

function outcomeOf(view: OwnerQuestionView): string {
  if (view.status === "stopped") return "The sub-agent was stopped";
  const answer = view.answer;
  if (!answer) return "Answered";
  if (answer.by === "default")
    return view.options.length > 0
      ? `Took its default ${cut(answer.text, 200)} after the deadline`
      : "Went on without an answer after the deadline";
  return view.answeredHere
    ? `Answered: ${cut(answer.text, TEXT_MAX)}`
    : `Answered in the app: ${cut(answer.text, TEXT_MAX)}`;
}

// UNIT_BOUNDARY_DESCRIPTION: the ids of a question form's fields. A card holds one question, so its ids are fixed; a list holds several, so each question's ids carry its run, and the fields of one are read apart from another's.
function fieldIds(runId: string | null) {
  const of = (id: string) => (runId === null ? id : `${id}:${runId}`);
  return {
    choice: of(OWNER_QUESTION_CHOICE_BLOCK),
    text: of(OWNER_QUESTION_TEXT_BLOCK),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the card of one sub-agent question in the owner's DM, which works like Claude's question UI: the options as a radio list with "Other", a text field for an answer of the owner's own, and "Send answer". An option longer than Slack shows is cut, and its index travels in its value, so the answer is the full option. Until the deadline the card says which default the sub-agent takes; once the question closed it says how. The question and the options show only as plain text. In a list the form is shorter: the asker and the question share one block, the question is cut sooner, and its fields carry the run in their ids.
export function questionCard(
  view: OwnerQuestionView,
  form: { inList: boolean } = { inList: false },
): {
  text: string;
  blocks: SlackBlock[];
} {
  const asker = `${view.driverName}'s sub-agent ${view.subAgentName} asks:`;
  const ids = fieldIds(form.inList ? view.runId : null);
  const head: SlackBlock[] = form.inList
    ? [
        {
          type: "section",
          text: plainText(
            `${cut(asker, 300)}\n${cut(view.question, LIST_TEXT_MAX)}`,
          ),
        },
      ]
    : [
        { type: "section", text: plainText(cut(asker, 300)) },
        { type: "section", text: plainText(cut(view.question, TEXT_MAX)) },
      ];
  if (view.status !== "asking")
    return {
      text: `${asker} ${cut(view.question, 200)}`,
      blocks: [
        ...head,
        { type: "context", elements: [plainText(outcomeOf(view))] },
      ],
    };
  const choice: SlackBlock[] =
    view.options.length > 0
      ? [
          {
            type: "input",
            block_id: ids.choice,
            optional: true,
            label: plainText("Your choice"),
            element: {
              type: "radio_buttons",
              action_id: OWNER_QUESTION_CHOICE_ACTION,
              options: [
                ...view.options.slice(0, 8).map((option, index) => ({
                  text: plainText(cut(option, OPTION_LABEL_MAX)),
                  value: String(index),
                })),
                { text: plainText("Other"), value: OTHER },
              ],
            },
          },
        ]
      : [];
  const then =
    view.options.length > 0
      ? `then takes ${cut(view.defaultOption, 200)}`
      : "then goes on without an answer";
  return {
    text: `${asker} ${cut(view.question, 200)}`,
    blocks: [
      ...head,
      ...choice,
      {
        type: "input",
        block_id: ids.text,
        optional: true,
        label: plainText("Your answer"),
        element: {
          type: "plain_text_input",
          action_id: OWNER_QUESTION_TEXT_ACTION,
          multiline: true,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: OWNER_QUESTION_SEND_ACTION,
            text: plainText("Send answer"),
            style: "primary",
            value: JSON.stringify({ question: view.runId }),
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Waits until ${slackDate(view.answerBy)}, ${then}.`,
          },
        ],
      },
    ],
  };
}

export function questionOfValue(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { question?: unknown };
    return typeof parsed.question === "string" ? parsed.question : null;
  } catch {
    return null;
  }
}

type FieldValues = Record<string, Record<string, unknown> | undefined>;

function fieldOf(fields: unknown, block: string, action: string) {
  if (typeof fields !== "object" || fields === null) return undefined;
  const value = (fields as FieldValues)[block]?.[action];
  return typeof value === "object" && value !== null
    ? (value as {
        selected_option?: { value?: unknown } | null;
        value?: unknown;
      })
    : undefined;
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's answer from a question's fields when they pressed "Send answer", on its card or in a list: a picked option as its full text, found by its index; "Other" or no pick with text written as that text; nothing usable as the hint to give privately.
export function answerFromFields(
  fields: unknown,
  options: readonly string[],
  runId: string,
): { text: string } | { hint: string } {
  const field = (action: string, block: "choice" | "text") =>
    fieldOf(fields, fieldIds(runId)[block], action) ??
    fieldOf(fields, fieldIds(null)[block], action);
  const picked = field(OWNER_QUESTION_CHOICE_ACTION, "choice")?.selected_option
    ?.value;
  const typed = field(OWNER_QUESTION_TEXT_ACTION, "text")?.value;
  const text = typeof typed === "string" ? typed.trim() : "";
  if (typeof picked === "string" && picked !== OTHER) {
    const option = options[Number(picked)];
    if (option !== undefined) return { text: option };
  }
  return text.length > 0 ? { text } : { hint: ANSWER_HINT };
}
