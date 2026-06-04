import { api } from "../../../api.js";

export async function preflightTermsGate(): Promise<boolean> {
  if (window.location.pathname === "/terms") return true;
  try {
    const [current, latest] = await Promise.all([
      api.terms.current.query(),
      api.terms.latestAcceptance.query(),
    ]);
    if (!latest || latest.version !== current.version) {
      window.location.replace("/terms");
      return false;
    }
    return true;
  } catch {
    return true;
  }
}
