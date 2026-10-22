import { Stop } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { timeAgo } from "../lib/format-time.js";
import { WorkingDots } from "../modules/sessions/components/working-dots.js";
import { useStore } from "../store.js";
import type { MockBackgroundTask } from "./data/mock-background-tasks.js";

interface Props {
  tasks: MockBackgroundTask[];
}

export function MockBackgroundChip({ tasks }: Props) {
  const [open, setOpen] = useState(false);
  const setOpenProcessOutputKey = useStore((s) => s.setOpenProcessOutputKey);

  if (tasks.length === 0) return null;

  const label =
    tasks.length === 1 ? "1 task running" : `${tasks.length} tasks running`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <WorkingDots size="sm" className="text-success" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-foreground">
            Background tasks
          </p>
        </div>
        <div className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onViewOutput={() => {
                setOpenProcessOutputKey(task.processKey);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TaskRow({
  task,
  onViewOutput,
}: {
  task: MockBackgroundTask;
  onViewOutput: () => void;
}) {
  const elapsed = timeAgo(new Date(task.startedAt));

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-border/50">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-foreground truncate">
          {task.command}
        </p>
        <p className="text-2xs text-muted-foreground">{elapsed}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="inline"
          className="text-2xs text-muted-foreground hover:text-foreground"
          onClick={onViewOutput}
        >
          View output
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Stop ${task.command}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Stop size={12} />
        </Button>
      </div>
    </div>
  );
}
