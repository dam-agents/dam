import type { FunctionImplementation } from "@a2ui/web_core/catalog";
import { createBasicCatalogFunctions } from "@a2ui/web_core/catalogs/basic/v1";
import type { DataContext } from "@a2ui/web_core/resolution";

import { A2uiExpressionError, toText } from "./values.js";

const LOCALE =
  typeof navigator === "undefined" ? undefined : navigator.language;

const IMPLEMENTATIONS: ReadonlyMap<string, FunctionImplementation> = new Map(
  createBasicCatalogFunctions({ locale: LOCALE }).map((fn) => [fn.name, fn]),
);

export const BASIC_VALIDATORS: ReadonlySet<string> = new Set([
  "required",
  "regex",
  "length",
  "numeric",
  "email",
]);

const NO_CONTEXT = {} as DataContext;

function openUrl(args: Record<string, unknown>): undefined {
  let url: URL;
  try {
    url = new URL(toText(args.url), window.location.href);
  } catch {
    throw new A2uiExpressionError(
      "EXECUTION_ERROR",
      "openUrl needs a valid URL",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new A2uiExpressionError(
      "EXECUTION_ERROR",
      `openUrl only opens http and https links, not ${url.protocol}`,
    );
  window.open(url.href, "_blank", "noopener,noreferrer");
  return undefined;
}

export function runBuiltin(
  name: string,
  args: Record<string, unknown>,
): unknown {
  if (name === "openUrl") return openUrl(args);
  const implementation = IMPLEMENTATIONS.get(name);
  if (!implementation)
    throw new A2uiExpressionError(
      "INVALID_FUNCTION_CALL",
      `function "${name}" has no renderer implementation`,
    );
  try {
    return implementation.execute(args, NO_CONTEXT);
  } catch (error) {
    throw new A2uiExpressionError(
      "EXECUTION_ERROR",
      error instanceof Error ? error.message : String(error),
    );
  }
}
