import type { SessionNavVariant } from "../../../../store.js";
import { SessionHeaderPopover } from "./session-header-popover.js";
import { SessionSidebar } from "./session-sidebar.js";
import { SessionTabs } from "./session-tabs.js";
import type { SessionNavProps } from "./types.js";

export type { SessionNavProps } from "./types.js";

interface SessionNavWrapperProps extends SessionNavProps {
  variant: SessionNavVariant;
}

export function SessionNavWrapper({
  variant,
  ...props
}: SessionNavWrapperProps) {
  switch (variant) {
    case "tabs":
      return <SessionTabs {...props} />;
    case "sidebar":
      return <SessionSidebar {...props} />;
    case "header-dropdown":
      return <SessionHeaderPopover {...props} />;
  }
}
