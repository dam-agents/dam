import type { StarterKitView } from "api-server-api";
import {
  exitOnServiceError,
  serviceErrorDescription,
  type ErrorDescription,
} from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import type {
  AuthRequiredError,
  KitRefusedError,
  TransportError,
} from "../domain/errors.js";
import { findCatalogKit, kitLinkUrl } from "../domain/kit-ref.js";
import type { KitService } from "../services/kit-service.js";

export function kitErrorDescription(
  error: KitRefusedError | TransportError | AuthRequiredError,
  host: string,
): ErrorDescription {
  if (error.kind !== "kit-refused") return serviceErrorDescription(error, host);
  return {
    stderr: `error: ${error.reason}\n`,
    exitCode:
      error.code === "BAD_REQUEST" || error.code === "NOT_FOUND"
        ? EXIT_INVALID_INPUT
        : EXIT_RUNTIME_FAILURE,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a Kit Ref the user typed, resolved to the kit
 * the web app would open for it: a GitHub repository link is read as a
 * linked kit at its current commit, and anything else is a kit id, or
 * `<catalog>/<id>` when two catalogs share the id. A ref that names no kit
 * exits with an error that names it and points at `dam kit list`.
 */
export async function resolveKitOrExit(
  svc: KitService,
  ref: string,
  host: string,
): Promise<{ kit: StarterKitView; catalogKits: readonly StarterKitView[] }> {
  const listed = await svc.list();
  exitOnServiceError(listed, host);
  const url = kitLinkUrl(ref);
  if (url !== null) {
    const linked = await svc.inspect(url);
    exitOnServiceError(linked, host, (error, h) =>
      error.kind === "kit-refused"
        ? {
            stderr: `error: no starter kit could be read from ${url}: ${error.reason}\n`,
            exitCode:
              error.code === "BAD_GATEWAY"
                ? EXIT_RUNTIME_FAILURE
                : EXIT_INVALID_INPUT,
          }
        : serviceErrorDescription(error, h),
    );
    return { kit: linked.value, catalogKits: listed.value };
  }
  const found = findCatalogKit(listed.value, ref);
  exitOnServiceError(found, host, (error) => ({
    stderr:
      error.kind === "kit-ambiguous"
        ? `error: more than one catalog has a starter kit \`${ref}\`; name one of ${error.matches.join(", ")}\n`
        : `error: no starter kit \`${ref}\` on this server\nhint: run \`dam kit list\` to see the starter kits\n`,
    exitCode: EXIT_INVALID_INPUT,
  }));
  return { kit: found.value, catalogKits: listed.value };
}
