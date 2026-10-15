import type { CheckRule } from "api-server-api/chat-forms";

import { BASIC_VALIDATORS } from "./functions/builtins.js";
import { evaluate } from "./functions/evaluate.js";
import {
  type EvalContext,
  isCall,
  isValidationResult,
  type ValidationResult,
} from "./functions/values.js";

export interface CheckFailure {
  message: string;
  severity: "error" | "warning" | "info";
  code?: string;
}

const FALLBACK_MESSAGE = "The value is not valid.";

function toResult(value: unknown): ValidationResult {
  if (isValidationResult(value)) return value;
  return { valid: value === true };
}

function messageOf(rule: CheckRule, result: ValidationResult): string {
  const builtin =
    isCall(rule.condition) && BASIC_VALIDATORS.has(rule.condition["@call"]);
  const preferred = builtin
    ? (rule.message ?? result.message)
    : (result.message ?? rule.message);
  return preferred ?? FALLBACK_MESSAGE;
}

export function failedChecks(
  checks: readonly CheckRule[] | undefined,
  ctx: EvalContext,
): CheckFailure[] {
  return (checks ?? []).flatMap((rule) => {
    const result = toResult(evaluate(rule.condition, ctx));
    if (result.valid) return [];
    return [
      {
        message: messageOf(rule, result),
        severity: result.severity ?? "error",
        ...(result.code === undefined ? {} : { code: result.code }),
      },
    ];
  });
}
