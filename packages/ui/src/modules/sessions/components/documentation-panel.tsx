import { Launch } from "@carbon/icons-react";

import { DOCS_URL } from "../../../constants.js";
import { externalLinkProps } from "../../../lib/external-link.js";
import { SidebarSection } from "./sidebar-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Documentation panel of the tiled rail: the
 * published documentation in the panel, and the same page in a new tab for a
 * reader who wants the room. The docs are served by another host, so the frame
 * shows whatever that host decides to serve.
 */
export function DocumentationPanel({ className }: { className?: string }) {
  return (
    <SidebarSection
      title="Documentation"
      open
      className={className}
      headerRight={
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          aria-label="Open documentation in a new window"
          data-testid="documentation-open"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Launch size={16} />
        </a>
      }
    >
      <iframe
        src={DOCS_URL}
        title="Documentation"
        data-testid="documentation-frame"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </SidebarSection>
  );
}
