import { SendAltFilled } from "@carbon/icons-react";
import type { OwnerQuestion } from "api-server-api";
import { type KeyboardEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useAnswerQuestion } from "../api/mutations.js";
import { answerByLine } from "../lib/delegation-state.js";

interface Props {
  driverAgentId: string;
  question: OwnerQuestion;
  more: number;
  onLater: () => void;
  onAnswered: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: a sub-agent's question in the chat's input: the main bar is the one place the owner answers, with an option or their own words, and either goes to the sub-agent that asked, not to the chat's agent. The question and the input are one box, and the input opens with the sub-agent's name, so it is plain who the words go to. Later gives the input back to the chat.
export function OwnerQuestionPrompt({
  driverAgentId,
  question,
  more,
  onLater,
  onAnswered,
}: Props) {
  const answer = useAnswerQuestion();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const placeholder =
    question.options.length > 0 ? "Or type your answer" : "Type your answer";
  useAutoResize(textareaRef, text, placeholder);
  const typed = text.trim();

  const send = (value: string) => {
    if (value === "" || answer.isPending) return;
    answer.mutate(
      { driverAgentId, id: question.id, answer: value },
      { onSuccess: onAnswered },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (isMobile()) return;
    e.preventDefault();
    send(typed);
  };

  return (
    <div className="px-2 @xs/chat:px-4 @xl/chat:px-8 pt-3 pb-1">
      <ChatColumn className="px-0 @xs/chat:px-4">
        <div
          data-testid="owner-question"
          className="flex flex-col overflow-hidden rounded-xl border border-primary bg-background"
        >
          <div className="flex flex-col gap-2.5 border-b border-border bg-muted/30 px-4 py-3.5">
            <div className="flex items-start gap-2">
              <span className="h-2 w-2 rounded-full bg-warning shrink-0 mt-1.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-foreground">
                  <span className="min-w-0 break-words">
                    {question.title} needs your answer
                  </span>
                  {more > 0 && (
                    <span className="text-2xs font-normal text-muted-foreground">
                      {more} more
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {answerByLine(question.answerBy)}, or it picks{" "}
                  <span className="font-medium text-foreground">
                    {question.default}
                  </span>
                </span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 text-muted-foreground"
                onClick={onLater}
                tooltip="Answer later. The question stays above the input."
              >
                Later
              </Button>
            </div>
            <p className="pl-4 text-sm text-foreground whitespace-pre-wrap break-words">
              {question.text}
            </p>
            {question.options.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-4">
                {question.options.map((option) => (
                  <Button
                    key={option}
                    variant="outline"
                    size="sm"
                    disabled={answer.isPending}
                    onClick={() => send(option)}
                    className="bg-background max-w-full"
                  >
                    <span className="truncate">{option}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-end gap-2 px-4 min-h-[56px]">
            <span className="mb-[17px] max-w-[40%] shrink-0 truncate rounded-md bg-accent-light px-1.5 text-sm leading-[22px] font-medium text-accent">
              @{question.title}
            </span>
            <Textarea
              ref={textareaRef}
              data-testid="owner-question-answer"
              className="flex-1 bg-transparent border-0 px-0 py-[17px] text-sm leading-[22px] text-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden focus-visible:ring-0 focus-visible:ring-offset-0"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={answer.isPending}
            />
            <Button
              variant="ghost"
              size="icon"
              className={`-mr-2 shrink-0 mb-[9px] ${typed ? "text-foreground" : "text-muted-foreground"} disabled:opacity-40`}
              onClick={() => send(typed)}
              disabled={typed === "" || answer.isPending}
              aria-label="Send answer"
              tooltip={`Send to ${question.title}`}
            >
              <SendAltFilled size={16} />
            </Button>
          </div>
        </div>
      </ChatColumn>
    </div>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: what stays above the input after Later, so a question put off is not forgotten: who waits, and the way back to the question.
export function PostponedQuestionsLine({
  questions,
  onAnswer,
}: {
  questions: readonly OwnerQuestion[];
  onAnswer: () => void;
}) {
  const first = questions[0];
  if (!first) return null;
  return (
    <div className="px-2 @xs/chat:px-4 @xl/chat:px-8 pt-3">
      <ChatColumn className="px-0 @xs/chat:px-4">
        <div
          data-testid="owner-question-waiting"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
          <span className="min-w-0 flex-1 truncate">
            {questions.length === 1
              ? `${first.title} is waiting on your answer`
              : `${questions.length} temporary agents are waiting on your answer`}
          </span>
          <Button
            variant="link"
            size="inline"
            className="shrink-0 text-xs"
            onClick={onAnswer}
          >
            Answer
          </Button>
        </div>
      </ChatColumn>
    </div>
  );
}
