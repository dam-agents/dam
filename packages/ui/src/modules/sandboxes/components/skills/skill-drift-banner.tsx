import { Renew } from "@carbon/icons-react";
import type { Skill } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
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
    <Notice
      icon={Renew}
      title={`${count} skill${count === 1 ? " is" : "s are"} out of date.`}
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onUpdateAll}
        >
          {busy && <Spinner size={14} />}
          Update all
        </Button>
      }
    >
      {nameList(drifted.map((s) => s.name))} {count === 1 ? "has" : "have"}{" "}
      changed upstream since {count === 1 ? "it was" : "they were"} installed.
    </Notice>
  );
}
