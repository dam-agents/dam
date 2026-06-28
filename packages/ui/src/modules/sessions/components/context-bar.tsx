import { Close } from "@carbon/icons-react";

const MOCK_SKILLS = ["Code Search", "File Editor", "Terminal", "Web Browser"];
const MOCK_SCHEDULE = { cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" };

export function ContextBar() {
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 border-t border-border bg-muted/20">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
          Skills
        </span>
        {MOCK_SKILLS.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground"
          >
            {name}
            <Close
              size={10}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            />
          </span>
        ))}
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          + Add
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
          Schedule
        </span>
        <span className="text-[11px] text-foreground">
          {MOCK_SCHEDULE.label}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {MOCK_SCHEDULE.cron}
        </span>
      </div>
    </div>
  );
}
