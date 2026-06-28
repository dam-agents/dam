import { Add, Close, Time, Watson } from "@carbon/icons-react";

const MOCK_SKILLS = ["Code Search", "File Editor", "Terminal", "Web Browser"];
const MOCK_WIKIS = [
  { name: "Platform runbook", pages: 14 },
  { name: "Onboarding guide", pages: 8 },
];
const MOCK_SCHEDULE = { cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" };

interface IterativeContextProps {
  layout?: "vertical" | "horizontal" | "compact";
}

export function IterativeContext({
  layout = "vertical",
}: IterativeContextProps) {
  if (layout === "horizontal") {
    return <HorizontalLayout />;
  }
  if (layout === "compact") {
    return <CompactLayout />;
  }
  return <VerticalLayout />;
}

function VerticalLayout() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Skills
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Add size={12} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MOCK_SKILLS.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground"
            >
              {name}
              <Close
                size={10}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              />
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Wikis
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Add size={12} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {MOCK_WIKIS.map((wiki) => (
            <div
              key={wiki.name}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <Watson size={14} className="text-muted-foreground shrink-0" />
              <span className="text-[12px] font-medium text-foreground flex-1 truncate">
                {wiki.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {wiki.pages} pages
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Schedule
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <Time size={14} className="text-muted-foreground" />
          <span className="text-[12px] text-foreground">
            {MOCK_SCHEDULE.label}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {MOCK_SCHEDULE.cron}
          </span>
        </div>
      </div>
    </div>
  );
}

function HorizontalLayout() {
  return (
    <div className="flex items-center gap-4 px-4 py-2">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-[10px] font-medium text-muted-foreground shrink-0">
          Skills:
        </span>
        <div className="flex gap-1 overflow-x-auto">
          {MOCK_SKILLS.map((name) => (
            <span
              key={name}
              className="shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
            >
              {name}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Add size={10} />
        </button>
      </div>

      <div className="h-3 w-px bg-border shrink-0" />

      <div className="flex items-center gap-1.5 shrink-0">
        <Watson size={12} className="text-muted-foreground" />
        <span className="text-[10px] text-foreground">
          {MOCK_WIKIS.length} wikis
        </span>
      </div>

      <div className="h-3 w-px bg-border shrink-0" />

      <div className="flex items-center gap-1.5 shrink-0">
        <Time size={12} className="text-muted-foreground" />
        <span className="text-[10px] text-foreground">
          {MOCK_SCHEDULE.label}
        </span>
      </div>
    </div>
  );
}

function CompactLayout() {
  return (
    <div className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {MOCK_SKILLS.map((name) => (
          <span
            key={name}
            className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
          >
            {name}
          </span>
        ))}
        <button
          type="button"
          className="rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          + Skill
        </button>
      </div>

      <div className="flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1 text-foreground">
          <Watson size={11} className="text-muted-foreground" />
          {MOCK_WIKIS.length} wikis linked
        </span>
        <span className="flex items-center gap-1 text-foreground">
          <Time size={11} className="text-muted-foreground" />
          {MOCK_SCHEDULE.label}
        </span>
      </div>
    </div>
  );
}
