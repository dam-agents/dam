import { openUsageReport } from "./api/open-usage-report.js";

declare global {
  interface Window {
    platformUsage?: { openReport: () => Promise<void> };
  }
}

window.platformUsage = { openReport: openUsageReport };
