import { api } from "../../../api.js";
import { parseRoute } from "../../platform/lib/routes.js";

export async function preflightTermsGate(): Promise<boolean> {
  if (parseRoute(window.location.pathname).view === "terms") return true;
  try {
    const [current, latest] = await Promise.all([
      api.terms.current.query(),
      api.terms.latestAcceptance.query(),
    ]);
    return !!latest && latest.version === current.version;
  } catch {
    return true;
  }
}
