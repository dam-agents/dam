import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxItem } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { useStore } from "../../../store.js";
import {
  EMPTY_ANSWER,
  type FieldAnswer,
  type FormAnswers,
  formContentOf,
  type FormField,
  formFieldsOf,
  isFormComplete,
} from "../lib/elicitation-form.js";
import { ChatColumn } from "./chat-column.js";

function FieldLabel({ field }: { field: FormField }) {
  if (!field.title && !field.description) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {field.title && (
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {field.title}
          {field.required && <span aria-hidden> *</span>}
        </span>
      )}
      {field.description && (
        <span className="text-sm text-foreground">{field.description}</span>
      )}
    </div>
  );
}

function FieldInput({
  field,
  answer,
  onChange,
}: {
  field: FormField;
  answer: FieldAnswer;
  onChange: (next: FieldAnswer) => void;
}) {
  if (field.kind === "boolean") {
    return (
      <CheckboxItem
        label={field.title ?? field.key}
        checked={answer.checked}
        onCheckedChange={(c) => onChange({ ...answer, checked: c === true })}
      />
    );
  }
  if (field.kind !== "choice") {
    return (
      <Input
        size="sm"
        type={field.kind === "text" ? "text" : "number"}
        aria-label={field.title ?? field.key}
        value={answer.text}
        onChange={(e) => onChange({ ...answer, text: e.target.value })}
      />
    );
  }
  return (
    <>
      {field.multiple ? (
        <div className="flex flex-col gap-2">
          {field.options.map((o) => (
            <CheckboxItem
              key={o.value}
              label={o.title}
              description={o.description}
              testId="elicitation-option"
              checked={answer.picked.includes(o.value)}
              onCheckedChange={(c) =>
                onChange({
                  ...answer,
                  picked:
                    c === true
                      ? [...answer.picked, o.value]
                      : answer.picked.filter((v) => v !== o.value),
                })
              }
            />
          ))}
        </div>
      ) : (
        <RadioGroup
          value={answer.picked[0] ?? ""}
          onValueChange={(v) => onChange({ ...answer, picked: [v] })}
        >
          {field.options.map((o) => (
            <RadioGroupItem
              key={o.value}
              value={o.value}
              label={o.title}
              description={o.description}
              testId="elicitation-option"
            />
          ))}
        </RadioGroup>
      )}
      <Input
        size="sm"
        placeholder={
          field.otherKey !== null && !field.multiple
            ? "Other — type your own answer, or add a note"
            : "Other — type your own answer"
        }
        aria-label={`Other answer${field.title ? ` for ${field.title}` : ""}`}
        data-testid="elicitation-other"
        value={answer.other}
        onChange={(e) => onChange({ ...answer, other: e.target.value })}
      />
    </>
  );
}

export function ElicitationPrompt() {
  const sessionId = useStore((s) => s.sessionId);
  const pending = useStore((s) => s.pendingElicitations);
  const resolve = useStore((s) => s.resolvePendingElicitation);
  const current = sessionId
    ? pending.find((e) => e.sessionId === sessionId)
    : undefined;
  const fields = useMemo(
    () => (current ? formFieldsOf(current.schema) : []),
    [current],
  );
  const [answers, setAnswers] = useState<FormAnswers>({});
  useEffect(() => setAnswers({}), [current?.key]);

  if (!current) return null;

  const complete = isFormComplete(fields, answers);
  const submit = () =>
    resolve(current.key, {
      action: "accept",
      content: formContentOf(fields, answers),
    });

  return (
    <div className="px-4 md:px-8 pt-3 pb-4" data-testid="elicitation-prompt">
      <ChatColumn>
        <form
          className="rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-col gap-4 max-h-[60vh] overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete) submit();
          }}
        >
          <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-warning shrink-0 mt-1.5" />
            <span className="whitespace-pre-wrap break-words min-w-0">
              {current.message}
            </span>
          </div>
          {fields.map((field) => (
            <fieldset key={field.key} className="flex flex-col gap-2 pl-4">
              <FieldLabel field={field} />
              <FieldInput
                field={field}
                answer={answers[field.key] ?? EMPTY_ANSWER}
                onChange={(next) =>
                  setAnswers((a) => ({ ...a, [field.key]: next }))
                }
              />
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!complete}>
              Send answer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="bg-background"
              onClick={() => resolve(current.key, { action: "decline" })}
            >
              Skip
            </Button>
          </div>
        </form>
      </ChatColumn>
    </div>
  );
}
