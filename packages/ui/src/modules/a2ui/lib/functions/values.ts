import { type DataBinding, isRecord } from "api-server-api/chat-forms";

export {
  A2uiExpressionError,
  absolutePath,
  type ErrorCode,
  isCall,
  isRecord,
} from "api-server-api/chat-forms";

export interface ValidationResult {
  valid: boolean;
  code?: string;
  message?: string;
  severity?: "error" | "warning" | "info";
}

export interface EvalContext {
  model: unknown;
  scope: string;
  indexes: readonly number[];
  catalogId: string | undefined;
  userActivation: boolean;
}

export function isBinding(value: unknown): value is DataBinding {
  return isRecord(value) && typeof value["@path"] === "string";
}

export function isValidationResult(value: unknown): value is ValidationResult {
  return isRecord(value) && typeof value.valid === "boolean";
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function toBoolean(value: unknown): boolean {
  if (isValidationResult(value)) return value.valid;
  return value === true;
}

export function unescapeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unescapeKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key.startsWith("@@") ? key.slice(1) : key,
      unescapeKeys(child),
    ]),
  );
}
