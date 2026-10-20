import { CheckmarkFilled, ChevronDown } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";

type TaskId =
  | "create-agent"
  | "send-message"
  | "create-connection"
  | "add-skill"
  | "apply-starter-kit"
  | "create-schedule"
  | "create-artifact"
  | "connect-slack";

interface TaskDef {
  id: TaskId;
  title: string;
  done: boolean;
}

const TASKS: TaskDef[] = [
  { id: "create-agent", title: "Create your first agent", done: true },
  { id: "send-message", title: "Send your agent a message", done: false },
  { id: "create-connection", title: "Create a connection", done: false },
  { id: "add-skill", title: "Add a skill", done: false },
  { id: "apply-starter-kit", title: "Try a starter kit", done: false },
  { id: "create-schedule", title: "Schedule a recurring task", done: false },
  { id: "create-artifact", title: "Create an artifact", done: false },
  { id: "connect-slack", title: "Use your agent in Slack", done: false },
];

export function GettingStartedChecklist() {
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const setView = useStore((s) => s.setView);

  if (dismissed) return null;

  const done = TASKS.filter((t) => t.done).length;
  const total = TASKS.length;

  const handleTaskClick = (task: TaskDef) => {
    if (task.id === "apply-starter-kit") {
      setView("packs");
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-md transition-colors hover:bg-muted/40"
      >
        <ProgressIndicator done={done} total={total} />
        <span className="text-sm font-medium text-foreground">Get started</span>
        <span className="text-sm text-muted-foreground">
          {done}/{total}
        </span>
      </button>
    );
  }

  return (
    <section
      aria-label="Get started"
      className="flex w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
    >
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <ProgressIndicator done={done} total={total} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <p className="text-sm text-muted-foreground">
            {done} of {total} done
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse checklist"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown size={16} />
        </Button>
      </div>

      <ul className="min-h-0 overflow-y-auto border-t border-border py-1.5">
        {TASKS.map((task) => (
          <li key={task.id} className="list-none">
            <button
              type="button"
              onClick={() => handleTaskClick(task)}
              className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-muted/40"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {task.done ? (
                  <CheckmarkFilled size={16} className="text-success" />
                ) : (
                  <span className="size-4 rounded-full border-2 border-border" />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  task.done ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {task.title}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

function ProgressIndicator({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const r = 8;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <svg width={22} height={22} className="shrink-0 -rotate-90">
      <circle
        cx={11}
        cy={11}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="text-border"
      />
      <circle
        cx={11}
        cy={11}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-success"
      />
    </svg>
  );
}
