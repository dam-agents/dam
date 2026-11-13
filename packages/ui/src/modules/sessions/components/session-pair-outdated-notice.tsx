import { WarningAltFilled } from "@carbon/icons-react";

export function SessionPairOutdatedNotice() {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 pl-3 text-sm text-muted-foreground"
    >
      <WarningAltFilled
        size={16}
        className="shrink-0 text-warning"
        aria-hidden
      />
      <span>This agent can&rsquo;t choose a model for a new session yet.</span>
    </p>
  );
}
