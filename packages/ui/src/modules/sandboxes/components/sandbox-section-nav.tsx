import { WarningAltFilled } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SandboxSection } from "../../platform/lib/routes.js";

interface SectionEntry {
  section: SandboxSection;
  title: string;
  description?: string;
}

export const SECTIONS: SectionEntry[] = [
  { section: "setup", title: "Sandbox" },
  {
    section: "connections",
    title: "Connections",
    description:
      "Connections let your agent talk to MCP servers and external services like GitHub.",
  },
  {
    section: "knowledge",
    title: "Knowledge",
    description:
      "Give this agent read-only access to other knowledge bases: it can list, search and read their content.",
  },
  {
    section: "network",
    title: "Network access",
    description:
      "Rules decide which outbound HTTP requests this agent can make. The most-specific rule wins. Without a matching rule, the request needs your approval on Home.",
  },
  {
    section: "environment",
    title: "Environment vars",
    description:
      "Variables are sent to the agent as plain text, so never add secrets here. Use them for non-sensitive configuration only. Store secrets in Connections.",
  },
  { section: "channels", title: "Channels" },
  { section: "skills", title: "Skills" },
  {
    section: "schedules",
    title: "Schedules",
    description: "Schedules let your agent run tasks periodically.",
  },
  {
    section: "usage",
    title: "Usage",
    description:
      "LLM spend for this agent, including work it delegated to other agents.",
  },
];

interface Props {
  header?: ReactNode;
  active: SandboxSection;
  onNavigate: (section: SandboxSection) => void;
  summaries?: Partial<Record<SandboxSection, string>>;
  warnings?: Partial<Record<SandboxSection, string>>;
}

export function SandboxSectionNav({
  header,
  active,
  onNavigate,
  summaries,
  warnings,
}: Props) {
  return (
    <nav
      aria-label="Agent sections"
      className="flex shrink-0 flex-col gap-1 md:sticky md:top-12 md:w-[245px] md:self-start"
    >
      {header}
      {SECTIONS.map((entry) => (
        <SectionNavItem
          key={entry.section}
          title={entry.title}
          summary={summaries?.[entry.section]}
          warning={warnings?.[entry.section]}
          active={entry.section === active}
          onClick={() => onNavigate(entry.section)}
        />
      ))}
    </nav>
  );
}

function SectionNavItem({
  title,
  summary,
  warning,
  active,
  onClick,
}: {
  title: string;
  summary?: string;
  warning?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {title}
        {warning && (
          <Tooltip content={warning}>
            <span className="ml-auto inline-flex text-warning">
              <WarningAltFilled size={16} aria-hidden />
              <span className="sr-only">{warning}</span>
            </span>
          </Tooltip>
        )}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {summary ?? "—"}
      </span>
    </button>
  );
}
