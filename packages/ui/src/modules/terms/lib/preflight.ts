import { api } from "../../../api.js";

export async function preflightTermsGate(): Promise<boolean> {
  if (window.location.pathname === "/terms") return true;
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
