import { Renew } from "@carbon/icons-react";
import type { Skill } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const MAX_NAMED = 3;

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= MAX_NAMED) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, MAX_NAMED).join(", ")} and ${names.length - MAX_NAMED} more`;
}

export function SkillDriftBanner({
  drifted,
  busy,
  onUpdateAll,
}: {
  drifted: Skill[];
  busy: boolean;
  onUpdateAll: () => void;
}) {
  const count = drifted.length;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm"
    >
      <Renew size={16} className="mt-px shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          {count} skill{count === 1 ? " is" : "s are"} out of date.
        </span>{" "}
        <span className="text-muted-foreground">
          {nameList(drifted.map((s) => s.name))} {count === 1 ? "has" : "have"}{" "}
          changed upstream since {count === 1 ? "it was" : "they were"}{" "}
          installed.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onUpdateAll}
        className="shrink-0"
      >
        {busy && <Spinner size={13} />}
        Update all
      </Button>
    </div>
  );
}
