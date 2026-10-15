import type { FunctionCall } from "./schema.js";

export type ErrorCode =
  "EXPRESSION_ERROR" | "EXECUTION_ERROR" | "INVALID_FUNCTION_CALL";

export class A2uiExpressionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCall(value: unknown): value is FunctionCall {
  return isRecord(value) && typeof value["@call"] === "string";
}

export function absolutePath(path: string, scope: string): string {
  return path.startsWith("/") ? path : `${scope}/${path}`;
}
