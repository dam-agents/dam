import { ChevronRight } from "@carbon/icons-react";
import type { MouseEvent } from "react";

import { useStore } from "../../../store.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { VIEW_DETAILS } from "../lib/copy.js";
import { formatPeriod, type SpendPeriod } from "../lib/spend-period.js";

function opensElsewhere(event: MouseEvent): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function ViewDetailsLink({ period }: { period: SpendPeriod }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const periodText = formatPeriod(period);
  const href = routeToPath({
    view: "settings",
    settingsTab: "usage",
    period: periodText,
  });

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (opensElsewhere(event)) return;
    event.preventDefault();
    navigateToSettings("usage", { period: periodText });
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className="flex items-center gap-1 text-sm text-accent hover:underline"
    >
      {VIEW_DETAILS}
      <ChevronRight size={14} aria-hidden="true" />
    </a>
  );
}
