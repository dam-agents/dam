import { catalogFor } from "../catalogs.js";
import { getAt } from "../data-model.js";
import type { FunctionCall } from "../schema.js";
import { runBuiltin } from "./builtins.js";
import { formatString } from "./format-string.js";
import {
  A2uiExpressionError,
  absolutePath,
  type EvalContext,
  isBinding,
  isCall,
  isRecord,
  toNumber,
  toText,
  unescapeKeys,
} from "./values.js";

function index(args: Record<string, unknown>, ctx: EvalContext): number {
  const current = ctx.indexes[ctx.indexes.length - 1];
  if (current === undefined)
    throw new A2uiExpressionError(
      "EXPRESSION_ERROR",
      "@index is only available inside a list template",
    );
  return current + (toNumber(evaluate(args.offset, ctx)) ?? 0);
}

function checkCallable(call: FunctionCall, ctx: EvalContext): void {
  const name = call["@call"];
  const catalogId = call.catalogId ?? ctx.catalogId;
  const catalog = catalogFor(catalogId);
  if (!catalog)
    throw new A2uiExpressionError(
      "INVALID_FUNCTION_CALL",
      catalogId === undefined
        ? `function "${name}" has no catalogId and the surface has no default catalog`
        : `catalog "${catalogId}" is not supported`,
    );
  const definition = catalog.functions[name];
  if (!definition)
    throw new A2uiExpressionError(
      "INVALID_FUNCTION_CALL",
      `function "${name}" is not in catalog "${catalogId}"`,
    );
  if (definition.allowedCallers === "agentOnly")
    throw new A2uiExpressionError(
      "INVALID_FUNCTION_CALL",
      `function "${name}" can only be called by the agent`,
    );
  if (definition.requiresUserActivation && !ctx.userActivation)
    throw new A2uiExpressionError(
      "EXPRESSION_ERROR",
      `function "${name}" needs a user action and cannot run in a binding or check`,
    );
}

function evaluateArgs(
  name: string,
  args: Record<string, unknown>,
  ctx: EvalContext,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if ((name === "and" || name === "or") && key === "values")
        return [
          key,
          Array.isArray(value)
            ? value.map((item) => evaluate(item, ctx))
            : value,
        ];
      return [key, evaluate(value, ctx)];
    }),
  );
}

export function callFunction(call: FunctionCall, ctx: EvalContext): unknown {
  const name = call["@call"];
  const args = call.args ?? {};
  if (name === "@index") return index(args, ctx);
  checkCallable(call, ctx);
  if (name === "formatString")
    return formatString(toText(evaluate(args.value, ctx)), {
      read: (path) => getAt(ctx.model, absolutePath(path, ctx.scope)),
      call: (inner, innerArgs) =>
        callFunction({ "@call": inner, args: innerArgs }, ctx),
    });
  return runBuiltin(name, evaluateArgs(name, args, ctx));
}

export function evaluate(value: unknown, ctx: EvalContext): unknown {
  if (isBinding(value))
    return getAt(ctx.model, absolutePath(value["@path"], ctx.scope));
  if (isCall(value)) return callFunction(value, ctx);
  if (isRecord(value) || Array.isArray(value)) return unescapeKeys(value);
  return value;
}
