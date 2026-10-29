import { Locked, WarningAltFilled } from "@carbon/icons-react";
import { type ReactNode, useEffect, useRef } from "react";

import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SandboxSection } from "../../platform/lib/routes.js";

interface SectionEntry {
  section: SandboxSection;
  title: string;
  description?: string;
}

export const SECTIONS: SectionEntry[] = [
  {
    section: "setup",
    title: "General",
    description: "Use and manage this agent.",
  },
  {
    section: "people",
    title: "People",
    description:
      "People who can change and use this agent with you. You stay its owner.",
  },
  {
    section: "providers",
    title: "Providers",
    description:
      "Choose which of your connected LLM providers this agent can use.",
  },
  {
    section: "connections",
    title: "Connections",
    description:
      "Connections let your agent talk to MCP servers and external services like GitHub.",
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
  {
    section: "channels",
    title: "Channels",
    description:
      "Channels let people message this agent from Slack or Telegram.",
  },
  {
    section: "chat-forms",
    title: "Chat forms",
    description:
      "How this agent may use forms, choices and cards in its web chat replies.",
  },
  {
    section: "skills",
    title: "Skills",
    description:
      "Skills are reusable instructions your agent loads when a task needs them.",
  },
  {
    section: "schedules",
    title: "Schedules",
    description: "Schedules let your agent run tasks periodically.",
  },
  {
    section: "artifacts",
    title: "Artifacts",
    description:
      "Files this agent produces — code, documents, and other outputs.",
  },
  {
    section: "environments",
    title: "Environments",
    description:
      "Sandboxes this agent creates to run its work for you and others to open, such as one per pull request. It controls them; you decide who may open them.",
  },
  {
    section: "usage",
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
  locked?: ReadonlySet<SandboxSection>;
}

const LOCKED_LABEL = "Only the owner changes this";

export function SandboxSectionNav({
  sections,
  header,
  active,
  onNavigate,
  summaries,
  warnings,
  locked,
}: Props) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  return (
    <nav
      aria-label="Agent sections"
      className="flex shrink-0 flex-col gap-1 md:sticky md:top-10 md:w-[245px] md:self-start"
    >
      <div ref={strip} className="contents">
        <Tabs
          ariaLabel="Agent sections"
          tabs={sections.map((entry) => ({
            value: entry.section,
            label: entry.title,
            trailing: warnings?.[entry.section] ? (
              <WarningAltFilled
                size={14}
                className="text-warning"
                aria-hidden
              />
            ) : locked?.has(entry.section) ? (
              <Locked
                size={14}
                className="text-muted-foreground"
                aria-label={LOCKED_LABEL}
              />
            ) : undefined,
          }))}
          value={active}
          onValueChange={onNavigate}
          variant="pill"
          size="sm"
          className="flex-row overflow-x-auto px-3 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [&>button]:shrink-0 md:hidden"
        />
      </div>
      {header}
      <div className="hidden flex-col gap-1 md:flex">
        {sections.map((entry) => (
          <SectionNavItem
            key={entry.section}
            title={entry.title}
            summary={summaries?.[entry.section]}
            warning={warnings?.[entry.section]}
            locked={locked?.has(entry.section) ?? false}
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
  locked,
  active,
  onClick,
}: {
  title: string;
  summary?: string;
  warning?: string;
  locked: boolean;
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
        {locked && (
          <Tooltip content={LOCKED_LABEL}>
            <span
              className="inline-flex text-muted-foreground"
              data-testid="section-lock"
            >
              <Locked size={14} aria-hidden />
              <span className="sr-only">{LOCKED_LABEL}</span>
            </span>
          </Tooltip>
        )}
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
