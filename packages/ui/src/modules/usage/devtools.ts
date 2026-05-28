import { openUsageReport } from "./api/open-usage-report.js";

// Power-user entry point. Inspectors run `platformUsage.openReport()` in the
// browser console; the fetch is auth-gated server-side (non-inspectors get a
// 403). Exposed unconditionally because the function existing on `window` is
// not meaningful without the server-side role check.
declare global {
  interface Window {
    platformUsage?: { openReport: () => Promise<void> };
  }
}

window.platformUsage = { openReport: openUsageReport };
