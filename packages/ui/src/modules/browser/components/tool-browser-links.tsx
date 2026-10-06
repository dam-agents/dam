import { useMemo } from "react";

import type { ToolChip } from "../../../types.js";
import { useAutoOpenBrowser } from "../hooks/use-auto-open-browser.js";
import { browserLinksIn } from "../lib/browser-link.js";

export function ToolBrowserLinks({ chip }: { chip: ToolChip }) {
  const links = useMemo(
    () => browserLinksIn((chip.content ?? []).map((c) => c.text).join("\n")),
    [chip.content],
  );
  useAutoOpenBrowser(links[links.length - 1] ?? null);
  return null;
}
