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
  // Full reload on purpose: the server signalled terms_stale, and a hard
  // navigation guarantees a clean refetch past the 412 gate.
  window.location.assign(routeToPath({ view: "terms" }));
}
