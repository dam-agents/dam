import { getAt } from "./data-model.js";
import { evaluate } from "./functions/evaluate.js";
import {
  absolutePath,
  type EvalContext,
  isBinding,
  toBoolean,
  toNumber,
  toText,
} from "./functions/values.js";
import type {
  CheckRule,
  DynamicBoolean,
  DynamicNumber,
  DynamicString,
  DynamicStringList,
  DynamicTone,
  DynamicValue,
  Tone,
} from "./schema.js";
import { TONES } from "./schema.js";
import { type CheckFailure, failedChecks } from "./validation.js";

export interface A2uiBindings {
  ctx: EvalContext;
  text: (value: DynamicString | undefined) => string;
  tone: (value: DynamicTone | undefined, fallback: Tone) => Tone;
  fieldText: (value: DynamicString | undefined, componentId: string) => string;
  boolean: (value: DynamicBoolean | undefined, componentId: string) => boolean;
  flag: (value: DynamicBoolean) => boolean;
  number: (value: DynamicNumber, componentId: string) => number;
  stringList: (value: DynamicStringList, componentId: string) => string[];
  target: (value: unknown, componentId: string) => string;
  absolute: (path: string) => string;
  read: (path: string) => unknown;
  context: (
    context: Record<string, DynamicValue> | undefined,
    userActivation: boolean,
  ) => Record<string, unknown>;
  checks: (checks: readonly CheckRule[] | undefined) => CheckFailure[];
}

export function createBindings(ctx: EvalContext): A2uiBindings {
  const absolute = (path: string) => absolutePath(path, ctx.scope);
  const read = (path: string) => getAt(ctx.model, absolute(path));
  const target = (value: unknown, componentId: string) =>
    isBinding(value) ? absolute(value["@path"]) : `${ctx.scope}/${componentId}`;
  const current = (value: unknown, componentId: string) =>
    isBinding(value) || value === undefined
      ? getAt(ctx.model, target(value, componentId))
      : evaluate(value, ctx);
  const bound = (value: unknown, componentId: string) => {
    const edited = getAt(ctx.model, target(value, componentId));
    return edited === undefined ? current(value, componentId) : edited;
  };

  const text = (value: DynamicString | undefined) =>
    value === undefined ? "" : toText(evaluate(value, ctx));

  return {
    ctx,
    text,
    tone: (value, fallback) => {
      const resolved = text(value);
      return TONES.find((tone) => tone === resolved) ?? fallback;
    },
    fieldText: (value, componentId) => toText(bound(value, componentId)),
    boolean: (value, componentId) => toBoolean(bound(value, componentId)),
    flag: (value) => toBoolean(evaluate(value, ctx)),
    number: (value, componentId) => toNumber(bound(value, componentId)) ?? 0,
    stringList: (value, componentId) => {
      const resolved = bound(value, componentId);
      return Array.isArray(resolved) ? resolved.map(String) : [];
    },
    target,
    absolute,
    read,
    context: (context, userActivation) =>
      Object.fromEntries(
        Object.entries(context ?? {}).map(([key, value]) => [
          key,
          evaluate(value, { ...ctx, userActivation }),
        ]),
      ),
    checks: (checks) => failedChecks(checks, ctx),
  };
}
