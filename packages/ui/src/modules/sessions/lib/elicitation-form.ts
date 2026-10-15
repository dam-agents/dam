import type {
  ElicitationContentValue,
  ElicitationSchema,
} from "@agentclientprotocol/sdk";

export interface ChoiceOption {
  value: string;
  title: string;
  description?: string;
}

export type FormField =
  | {
      kind: "choice";
      key: string;
      title?: string;
      description?: string;
      required: boolean;
      multiple: boolean;
      options: ChoiceOption[];
      otherKey: string | null;
    }
  | {
      kind: "text";
      key: string;
      title?: string;
      description?: string;
      required: boolean;
    }
  | {
      kind: "number" | "integer";
      key: string;
      title?: string;
      description?: string;
      required: boolean;
    }
  | {
      kind: "boolean";
      key: string;
      title?: string;
      description?: string;
      required: boolean;
    };

export interface FieldAnswer {
  picked: string[];
  other: string;
  text: string;
  checked: boolean;
}

export type FormAnswers = Record<string, FieldAnswer>;

export const EMPTY_ANSWER: FieldAnswer = {
  picked: [],
  other: "",
  text: "",
  checked: false,
};

const OTHER_SUFFIX = "_custom";

type RawProperty = Record<string, unknown>;

function text(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function optionsOf(list: unknown): ChoiceOption[] | null {
  if (!Array.isArray(list)) return null;
  const out: ChoiceOption[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ value: item, title: item });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const o = item as RawProperty;
    if (typeof o.const !== "string") continue;
    out.push({
      value: o.const,
      title: text(o.title) ?? o.const,
      ...(text(o.description) && { description: text(o.description) }),
    });
  }
  return out.length > 0 ? out : null;
}

function choicesOf(prop: RawProperty): {
  multiple: boolean;
  options: ChoiceOption[];
} | null {
  if (prop.type === "array") {
    const items = (prop.items ?? {}) as RawProperty;
    const options = optionsOf(items.anyOf) ?? optionsOf(items.enum);
    return options && { multiple: true, options };
  }
  if (prop.type !== "string") return null;
  const options =
    optionsOf(prop.oneOf) ?? optionsOf(prop.anyOf) ?? optionsOf(prop.enum);
  return options && { multiple: false, options };
}

function isPlainText(prop: unknown): boolean {
  if (typeof prop !== "object" || prop === null) return false;
  const p = prop as RawProperty;
  return p.type === "string" && choicesOf(p) === null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads an ACP form elicitation's requested schema
 * into the fields the chat renders, and turns the user's input back into the
 * `content` of an `accept`. Every choice field gets a free-text "Other" box,
 * so a fixed option list never forces a wrong pick. claude-agent-acp already
 * sends that box for each AskUserQuestion question as `<key>_custom`; it is
 * shown under its question and answered under its own key. A choice field
 * with no such companion gets one of ours, and the typed text becomes the
 * field's answer.
 */
export function formFieldsOf(schema: ElicitationSchema): FormField[] {
  const properties = (schema.properties ?? {}) as Record<string, RawProperty>;
  const required = new Set(schema.required ?? []);
  const companions = new Set<string>();
  const fields: FormField[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const choices = choicesOf(prop);
    if (choices === null) continue;
    const otherKey = isPlainText(properties[key + OTHER_SUFFIX])
      ? key + OTHER_SUFFIX
      : null;
    if (otherKey !== null) companions.add(otherKey);
    fields.push({
      kind: "choice",
      key,
      title: text(prop.title),
      description: text(prop.description),
      required: required.has(key),
      ...choices,
      otherKey,
    });
  }
  const ordered: FormField[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const choice = fields.find((f) => f.key === key);
    if (choice) {
      ordered.push(choice);
      continue;
    }
    if (companions.has(key)) continue;
    const kind =
      prop.type === "number" || prop.type === "integer"
        ? prop.type
        : prop.type === "boolean"
          ? "boolean"
          : "text";
    ordered.push({
      kind,
      key,
      title: text(prop.title),
      description: text(prop.description),
      required: required.has(key),
    });
  }
  return ordered;
}

type ChoiceField = Extract<FormField, { kind: "choice" }>;

function otherReplacesPick(field: ChoiceField): boolean {
  return field.otherKey === null && !field.multiple;
}

export function withPick(
  field: ChoiceField,
  answer: FieldAnswer,
  value: string,
): FieldAnswer {
  return {
    ...answer,
    picked: [value],
    ...(otherReplacesPick(field) && { other: "" }),
  };
}

export function withOther(
  field: ChoiceField,
  answer: FieldAnswer,
  other: string,
): FieldAnswer {
  return {
    ...answer,
    other,
    ...(otherReplacesPick(field) && other.trim() !== "" && { picked: [] }),
  };
}

function answerOf(answers: FormAnswers, key: string): FieldAnswer {
  return answers[key] ?? EMPTY_ANSWER;
}

export function formContentOf(
  fields: FormField[],
  answers: FormAnswers,
): Record<string, ElicitationContentValue> {
  const content: Record<string, ElicitationContentValue> = {};
  for (const field of fields) {
    const a = answerOf(answers, field.key);
    if (field.kind === "boolean") {
      content[field.key] = a.checked;
      continue;
    }
    if (field.kind === "text") {
      if (a.text.trim() !== "") content[field.key] = a.text.trim();
      continue;
    }
    if (field.kind !== "choice") {
      const n = Number(a.text);
      const whole = field.kind === "integer" ? Number.isInteger(n) : true;
      if (a.text.trim() !== "" && Number.isFinite(n) && whole)
        content[field.key] = n;
      continue;
    }
    const other = a.other.trim();
    if (field.otherKey !== null) {
      if (a.picked.length > 0)
        content[field.key] = field.multiple ? a.picked : a.picked[0];
      if (other !== "") content[field.otherKey] = other;
      continue;
    }
    if (field.multiple) {
      const all = other === "" ? a.picked : [...a.picked, other];
      if (all.length > 0) content[field.key] = all;
    } else if (other !== "") {
      content[field.key] = other;
    } else if (a.picked.length > 0) {
      content[field.key] = a.picked[0];
    }
  }
  return content;
}

export function isFormComplete(
  fields: FormField[],
  answers: FormAnswers,
): boolean {
  const content = formContentOf(fields, answers);
  return fields.every((field) => {
    if (!field.required) return true;
    if (field.key in content) return true;
    return (
      field.kind === "choice" &&
      field.otherKey !== null &&
      field.otherKey in content
    );
  });
}
