import { cn } from "@/lib/utils";

import type { SandboxSection } from "../../platform/lib/routes.js";

interface SectionEntry {
  section: SandboxSection;
  title: string;
}

const SECTIONS: SectionEntry[] = [
  { section: "setup", title: "Sandbox Setup" },
  { section: "connections", title: "Connections" },
  { section: "channels", title: "Channels" },
  { section: "skills", title: "Skills" },
  { section: "schedules", title: "Schedules" },
  { section: "artifacts", title: "Artifacts" },
  { section: "usage", title: "Usage" },
];

interface Props {
  active: SandboxSection;
  onNavigate: (section: SandboxSection) => void;
  summaries?: Partial<Record<SandboxSection, string>>;
  /** Sections needing attention, mapped to why. Renders a marker beside the
   *  title so a problem is findable from any section, not only the one that
   *  happens to be open. */
  warnings?: Partial<Record<SandboxSection, string>>;
}

export function SandboxSectionNav({
  active,
  onNavigate,
  summaries,
  warnings,
}: Props) {
  return (
    <nav
      aria-label="Sandbox sections"
      className="flex shrink-0 flex-col gap-1 md:sticky md:top-12 md:w-[245px] md:self-start"
    >
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
        {/* aria-hidden: the button names itself from this row and the summary
            beneath it, so a label here would be concatenated into that name
            rather than announced as a status. The summary carries the
            condition in words. */}
        {warning && (
          <span
            aria-hidden
            title={warning}
            className="size-1.5 shrink-0 rounded-full bg-warning"
          />
        )}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {summary ?? "—"}
      </span>
    </button>
  );
}
