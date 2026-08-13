import { rememberReturnPath } from "../../../lib/return-path.js";
import { parseRoute, routeToPath } from "../../platform/lib/routes.js";

let redirecting = false;
let termsStale = false;

export function isTermsStale(): boolean {
  return termsStale;
}

export function onTermsStale(): void {
  termsStale = true;
  if (redirecting || parseRoute(window.location.pathname).view === "terms")
    return;
  redirecting = true;
  rememberReturnPath("terms");
  window.location.assign(routeToPath({ view: "terms" }));
}

export function isTermsStaleError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "data" in error &&
    !!(error as { data?: { termsStale?: boolean } }).data?.termsStale
  );
}
