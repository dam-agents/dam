import type { DelegationAnswer, OwnerQuestionInput } from "api-server-api";

export const DEFAULT_ANSWER_WITHIN_MS = 24 * 60 * 60 * 1000;
export const MIN_ANSWER_WITHIN_MS = 60 * 1000;

// UNIT_BOUNDARY_DESCRIPTION: the least time a run that continues from an answer gets, so a sub-agent that asked with its time limit almost spent can still act on the answer.
export const MIN_CONTINUE_MS = 5 * 60 * 1000;

// UNIT_BOUNDARY_DESCRIPTION: how long a sub-agent that waits for an answer sits idle before its machine sleeps: short, since awake it holds its share of its owner's memory, and long enough that a quick answer finds it awake.
export const ASKING_IDLE_MIN = 5;

export interface AskedQuestion {
  text: string;
  options: string[];
  defaultOption: string;
}

// UNIT_BOUNDARY_DESCRIPTION: a question as the platform keeps it, or why it is refused: a question with options offers at least two, which must differ, and its default must be one of them, so the owner sees what happens without an answer as one of the choices; an open question has none, and its default is the sub-agent's own words.
export function askedQuestion(
  input: OwnerQuestionInput,
): AskedQuestion | { error: string } {
  const options = (input.options ?? []).map((o) => o.trim());
  if (options.length === 0)
    return {
      text: input.question.trim(),
      options,
      defaultOption: input.default.trim(),
    };
  if (options.length === 1)
    return {
      error:
        "one option is no choice: give every real choice as its own option, or leave options out for an open question",
    };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
    return { error: "the options must differ from one another" };
  const defaultOption = options.find(
    (o) => o.toLowerCase() === input.default.trim().toLowerCase(),
  );
  if (!defaultOption)
    return {
      error: `default must be one of the options: ${options.join(" | ")}`,
    };
  return { text: input.question.trim(), options, defaultOption };
}

export function answerDeadline(
  now: Date,
  withinMinutes: number | undefined,
  maxMs: number,
): Date {
  const asked =
    withinMinutes === undefined
      ? DEFAULT_ANSWER_WITHIN_MS
      : withinMinutes * 60_000;
  return new Date(
    now.getTime() + Math.min(Math.max(asked, MIN_ANSWER_WITHIN_MS), maxMs),
  );
}

const timeOf = (at: Date): string =>
  `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

// UNIT_BOUNDARY_DESCRIPTION: the task of the run that continues from an answer, which says who answered: the owner, or nobody, so the sub-agent goes on with its own default.
export function answerTask(
  question: string,
  answer: Pick<DelegationAnswer, "text" | "by">,
  answerBy: Date,
): string {
  const asked = `You asked your owner: ${question}`;
  const go =
    "Go on with your task from where you stopped, and report its result.";
  if (answer.by === "default")
    return `${asked}\n\nNobody answered by ${timeOf(answerBy)}, so go on with your default: ${answer.text}\n\n${go}`;
  return `${asked}\n\nYour owner's answer: ${answer.text}\n\n${go}`;
}
