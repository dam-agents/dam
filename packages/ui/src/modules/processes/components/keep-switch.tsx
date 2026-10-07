import type { ProcessRow } from "agent-runtime-api";

import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useSetKeep } from "../api/mutations.js";
import {
  ALWAYS_ON_KEEP_HINT,
  keepSourceCaption,
  keepStatusLabel,
} from "../lib/process-copy.js";

interface Props {
  agentId: string;
  row: ProcessRow;
  alwaysOn: boolean;
}

export function KeepSwitch({ agentId, row, alwaysOn }: Props) {
  const setKeep = useSetKeep(agentId);
  const pending = setKeep.isPending ? setKeep.variables : undefined;
  const keepsAwake = pending?.keepsAwake ?? row.keepsAwake;
  const caption = keepSourceCaption({
    kind: row.kind,
    keepSource: pending ? "user" : row.keepSource,
  });

  const toggle = (
    <Switch
      checked={keepsAwake}
      onCheckedChange={(next) =>
        setKeep.mutate({ key: row.key, keepsAwake: next })
      }
      disabled={alwaysOn || setKeep.isPending}
      label={`${row.command} keeps the agent awake`}
      testId="process-keep-switch"
      className={cn(alwaysOn && "pointer-events-none")}
    />
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      {alwaysOn ? (
        <Tooltip content={ALWAYS_ON_KEEP_HINT} side="right">
          <span tabIndex={0} className="inline-flex shrink-0 rounded-full">
            {toggle}
          </span>
        </Tooltip>
      ) : (
        toggle
      )}
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            keepsAwake ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {keepStatusLabel({ kind: row.kind, keepsAwake }, alwaysOn)}
        </span>
        {caption && (
          <span
            data-testid="process-keep-source"
            className="text-[11px] text-muted-foreground"
          >
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
