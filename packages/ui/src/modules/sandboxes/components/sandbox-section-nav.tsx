import { WarningAltFilled } from "@carbon/icons-react";
import {
  Briefcase,
  CalendarEvent,
  type CarbonPictogramType,
  CloudComputing,
  ConnectApplications,
  FinanceAndSupplyChain,
  FoundationModel,
  Keystores,
  Network_02,
  Robot,
  Slack,
  UserInterface,
} from "@carbon/pictograms-react";
import type { ReactNode } from "react";

import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SandboxSection } from "../../platform/lib/routes.js";

interface SectionEntry {
  section: SandboxSection;
  title: string;
  pictogram: CarbonPictogramType;
  description?: string;
}

export const SECTIONS: SectionEntry[] = [
  {
    section: "setup",
    pictogram: Robot,
    title: "General",
    description: "Use and manage this agent.",
  },
  {
    section: "providers",
    pictogram: FoundationModel,
    title: "Providers",
    description:
      "Choose which of your connected LLM providers this agent can use.",
  },
  {
    section: "connections",
    pictogram: ConnectApplications,
    title: "Connections",
    description:
      "Connections let your agent talk to MCP servers and external services like GitHub.",
  },
  {
    section: "network",
    pictogram: Network_02,
    title: "Network access",
    description:
      "Rules decide which outbound HTTP requests this agent can make. The most-specific rule wins. Without a matching rule, the request needs your approval on Home.",
  },
  {
    section: "environment",
    pictogram: Keystores,
    title: "Environment vars",
    description:
      "Variables are sent to the agent as plain text, so never add secrets here. Use them for non-sensitive configuration only. Store secrets in Connections.",
  },
  {
    section: "channels",
    pictogram: Slack,
    title: "Channels",
    description:
      "Channels let people message this agent from Slack or Telegram.",
  },
  {
    section: "chat-forms",
    pictogram: UserInterface,
    title: "Chat forms",
    description:
      "How this agent may use forms, choices and cards in its web chat replies.",
  },
  {
    section: "skills",
    pictogram: Briefcase,
    title: "Skills",
    description:
      "Skills are reusable instructions your agent loads when a task needs them.",
  },
  {
    section: "schedules",
    pictogram: CalendarEvent,
    title: "Schedules",
    description: "Schedules let your agent run tasks periodically.",
  },
  {
    section: "environments",
    pictogram: CloudComputing,
    title: "Environments",
    description:
      "Sandboxes this agent creates to run its work for you and others to open, such as one per pull request. It controls them; you decide who may open them, and grant connections.",
  },
  {
    section: "usage",
    pictogram: FinanceAndSupplyChain,
    title: "Usage",
    description:
      "What this agent spends on models, including the sub-agents it started, and its spend limit.",
  },
];

interface Props {
  sections: SectionEntry[];
  header?: ReactNode;
  active: SandboxSection;
  onNavigate: (section: SandboxSection) => void;
  summaries?: Partial<Record<SandboxSection, string>>;
  warnings?: Partial<Record<SandboxSection, string>>;
}

export function SandboxSectionNav({
  sections,
  header,
  active,
  onNavigate,
  summaries,
  warnings,
}: Props) {
  return (
    <nav
      aria-label="Agent sections"
      className="flex shrink-0 flex-col gap-1 md:sticky md:top-10 md:w-[245px] md:self-start"
    >
      {header}
      <div className="px-3 md:hidden">
        <Select
          aria-label="Section"
          value={active}
          onChange={(e) => {
            const next = sections.find((s) => s.section === e.target.value);
            if (next) onNavigate(next.section);
          }}
        >
          {sections.map((entry) => (
            <option key={entry.section} value={entry.section}>
              {warnings?.[entry.section] ? `${entry.title} (!)` : entry.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="hidden flex-col gap-1 md:flex">
        {sections.map((entry) => (
          <SectionNavItem
            key={entry.section}
            title={entry.title}
            summary={summaries?.[entry.section]}
            warning={warnings?.[entry.section]}
            active={entry.section === active}
            onClick={() => onNavigate(entry.section)}
          />
        ))}
      </div>
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
      aria-current={active ? "page" : undefined}
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
      <span title={summary} className="truncate text-sm text-muted-foreground">
        {summary ?? "—"}
      </span>
    </button>
  );
}
