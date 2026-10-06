import type { ToolChip } from "../../../types.js";
import { useBrowserToolLinks } from "../hooks/use-browser-tool-links.js";
import { BrowserLinkChip } from "./browser-link-chip.js";

export function ToolBrowserLinks({ chip }: { chip: ToolChip }) {
  const links = useBrowserToolLinks(chip);
  if (links.length === 0) return null;
  return (
    <div className="my-1 flex flex-wrap gap-1.5 pl-4">
      {links.map((url) => (
        <BrowserLinkChip key={url} url={url} />
      ))}
    </div>
  );
}
