import { WarningAlt } from "@carbon/icons-react";
import { match } from "ts-pattern";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { AccessSummary, AccessTone } from "../lib/grant-tool-access.js";

function ToneIcon({ tone }: { tone: AccessTone }) {
  return match(tone)
    .with("writes", () => (
      <WarningAlt size={12} className="shrink-0" aria-hidden />
    ))
    .with("asks", () => (
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
    ))
    .with("quiet", () => null)
    .exhaustive();
}

export function AccessSummaryLabel({
  summary,
  testId,
}: {
  summary: AccessSummary;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-sm",
        summary.tone === "writes" ? "text-warning-fg" : "text-muted-foreground",
      )}
      data-tone={summary.tone}
      data-testid={testId}
    >
      <ToneIcon tone={summary.tone} />
      <span className="min-w-0 break-words">{summary.text}</span>
    </span>
  );
}

export function AccessSummaryBadge({
  summary,
  testId,
}: {
  summary: AccessSummary;
  testId?: string;
}) {
  return (
    <Badge
      variant={summary.tone === "quiet" ? "muted" : "warning"}
      className="gap-1.5"
      data-tone={summary.tone}
      data-testid={testId}
    >
      <ToneIcon tone={summary.tone} />
      {summary.text}
    </Badge>
  );
}

export function WritesWithoutAskingMark({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    <Badge variant="warning" className="shrink-0 gap-1" data-testid={testId}>
      <WarningAlt size={12} aria-hidden />
      {label}
    </Badge>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the marks beside a connection's name where a tool that does not read runs without asking: on an Agent's row for that Agent's grant, and on the Connections page with how many of its Agents do.
export function WritesWithoutAskingMarks({
  connectionId,
  grant,
  agentsWriting,
}: {
  connectionId: string;
  grant: AccessSummary | undefined;
  agentsWriting: number;
}) {
  return (
    <>
      {grant?.tone === "writes" && (
        <WritesWithoutAskingMark
          label="Writes without asking"
          testId={`grant-writes-mark-${connectionId}`}
        />
      )}
      {agentsWriting > 0 && (
        <WritesWithoutAskingMark
          label={
            agentsWriting === 1
              ? "1 agent writes without asking"
              : `${agentsWriting} agents write without asking`
          }
          testId={`connection-writes-mark-${connectionId}`}
        />
      )}
    </>
  );
}
