import { cn } from "@/lib/utils";

import type { SandboxSection } from "../../platform/lib/routes.js";

interface SectionEntry {
  section: SandboxSection;
  title: string;
}

const SECTIONS: SectionEntry[] = [
  { section: "setup", title: "Sandbox Setup" },
  { section: "connections", title: "Connections" },
  { section: "skills", title: "Skills" },
  { section: "schedules", title: "Schedules" },
  { section: "artifacts", title: "Artifacts" },
  { section: "forks", title: "Forks" },
];

/** Sections hidden while their feature flag is off. */
const FEATURE_GATED: Partial<Record<SandboxSection, "artifacts">> = {
  artifacts: "artifacts",
};

interface Props {
  active: SandboxSection;
  onNavigate: (section: SandboxSection) => void;
  // Live one-line summary per section, keyed by section id (slice 03).
  summaries?: Partial<Record<SandboxSection, string>>;
  /** Feature-gated sections to include (from the caller's flags). */
  showArtifacts?: boolean;
}

export function SandboxSectionNav({
  active,
  onNavigate,
  summaries,
  showArtifacts = false,
}: Props) {
  const sections = SECTIONS.filter(
    (entry) => !FEATURE_GATED[entry.section] || showArtifacts,
  );
  return (
    <nav
      aria-label="Sandbox sections"
      className="flex shrink-0 flex-col gap-1 md:sticky md:top-12 md:w-[245px] md:self-start"
    >
      {sections.map((entry) => (
        <SectionNavItem
          key={entry.section}
          title={entry.title}
          summary={summaries?.[entry.section]}
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
  active,
  onClick,
}: {
  title: string;
  summary?: string;
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
      <span className="text-[14px] font-medium text-foreground">{title}</span>
      <span className="truncate text-[13px] text-muted-foreground">
        {summary ?? "—"}
      </span>
    </button>
  );
}
