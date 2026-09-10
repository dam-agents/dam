import {
  Edit,
  OverflowMenuVertical,
  Pause,
  Play,
  SendAltFilled,
  Share,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getBrand } from "@/brand";
import { DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { useOwnerSchedules } from "../api/queries.js";
import { ScheduleResultsModal } from "../components/schedule-results-modal.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { formatRunTime, scheduleCadenceText } from "../lib/schedule-format.js";

interface AgentGroup {
  agentId: string;
  agentName: string;
  schedules: Schedule[];
}

export function SchedulesView() {
  useEffect(() => {
    const prev = document.title;
    const brand = getBrand();
    document.title = `Schedules · ${brand.name}`;
    return () => {
      document.title = prev;
    };
  }, []);

  const { data: schedules, isPending: schedulesPending } = useOwnerSchedules();
  const agents = useAgentsList();
  const { isPending: agentsPending } = useAgents();
  const setView = useStore((s) => s.setView);

  const [editing, setEditing] = useState<{
    schedule: Schedule;
    agentName: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingResults, setViewingResults] = useState<Schedule | null>(null);

  const loading = schedulesPending || agentsPending;
  const live = new Set(agents.map((a) => a.id));
  const liveSchedules = (schedules ?? []).filter((s) => live.has(s.agentId));

  const groups = useMemo<AgentGroup[]>(() => {
    const byAgent = new Map<string, Schedule[]>();
    for (const s of liveSchedules) {
      const list = byAgent.get(s.agentId) ?? [];
      list.push(s);
      byAgent.set(s.agentId, list);
    }
    return Array.from(byAgent.entries()).map(([agentId, scheds]) => ({
      agentId,
      agentName:
        agents.find((a) => a.id === agentId)?.name ?? agentId.slice(0, 8),
      schedules: scheds,
    }));
  }, [liveSchedules, agents]);

  const hasSchedules = !loading && liveSchedules.length > 0;

  if (loading) {
    return (
      <div className="anim-in">
        <PageHeader title="Schedules" />
        <ListSkeleton rows={3} rowHeight={64} />
      </div>
    );
  }

  if (!hasSchedules) {
    return (
      <div className="anim-in">
        <PageHeader
          title="No schedules yet"
          description={
            <span className="inline-block max-w-[560px]">
              A schedule wakes an agent on a cadence you set — every morning,
              every Monday, or whenever you need. Create an agent first, then
              add schedules to automate its work.
            </span>
          }
          actions={<Button onClick={() => setView("home")}>Go to home</Button>}
        />
      </div>
    );
  }

  return (
    <div className="anim-in">
      <PageHeader
        title="Schedules"
        description="Schedules wake your agents on a cadence and give them a task. Each run creates a session you can review."
        actions={
          <Button
            disabled={agents.length === 0}
            onClick={() => setCreating(true)}
          >
            Create schedule
          </Button>
        }
      />

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <AgentScheduleGroup
            key={group.agentId}
            group={group}
            onEdit={(schedule) =>
              setEditing({ schedule, agentName: group.agentName })
            }
            onViewResults={setViewingResults}
          />
        ))}
      </div>

      {editing && (
        <ScheduleFormModal
          agentId={editing.schedule.agentId}
          agentName={editing.agentName}
          existing={editing.schedule}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {creating && (
        <CreateScheduleModal
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setCreating(false)}
        />
      )}

      {viewingResults && (
        <ScheduleResultsModal
          agentId={viewingResults.agentId}
          schedule={viewingResults}
          onClose={() => setViewingResults(null)}
          onResumeSession={(sessionId) => {
            const store = useStore.getState();
            store.openAgentSession(viewingResults.agentId, sessionId);
          }}
        />
      )}
    </div>
  );
}

function AgentScheduleGroup({
  group,
  onEdit,
  onViewResults,
}: {
  group: AgentGroup;
  onEdit: (schedule: Schedule) => void;
  onViewResults: (schedule: Schedule) => void;
}) {
  const openAgentSession = useStore((s) => s.openAgentSession);

  return (
    <div>
      <button
        type="button"
        onClick={() => openAgentSession(group.agentId)}
        className="mb-3 text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
      >
        {group.agentName}
      </button>

      <div className="flex flex-col gap-1.5">
        {group.schedules.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            agentName={group.agentName}
            onEdit={() => onEdit(schedule)}
            onViewResults={() => onViewResults(schedule)}
          />
        ))}
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  agentName,
  onEdit,
  onViewResults,
}: {
  schedule: Schedule;
  agentName: string;
  onEdit: () => void;
  onViewResults: () => void;
}) {
  const { id, name, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const guardEdit = useScheduleEditGuard();

  const cadence = scheduleCadenceText(schedule);
  const nextRunTime = status?.nextRun ? formatRunTime(status.nextRun) : null;

  const handleEdit = () => void guardEdit(schedule, agentName, onEdit);

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Are you sure you want to delete this schedule?",
        `Delete ${name}?`,
        { kind: "destructive", confirmLabel: "Delete Schedule" },
      )
    )
      deleteSchedule.mutate({ id });
  };

  const handleReset = async () => {
    if (
      await showConfirm(
        `Reset the session for "${name}"? The next run starts a fresh conversation.`,
        "Reset session",
        { confirmLabel: "Reset session" },
      )
    )
      resetScheduleSession.mutate({ id });
  };

  const subtitle = [
    cadence,
    nextRunTime && enabled ? `Next ${nextRunTime}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "group flex items-center gap-4 rounded-xl px-4 py-3",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          enabled
            ? "bg-accent/10 text-accent"
            : "bg-muted text-muted-foreground",
        )}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {name}
        </p>
        {subtitle && (
          <p className="truncate text-[14px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Edit schedule"
          onClick={handleEdit}
        >
          <Edit size={16} />
        </Button>

        <Switch
          checked={enabled}
          onCheckedChange={() => toggleSchedule.mutate({ id })}
          label={enabled ? "Disable schedule" : "Enable schedule"}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Schedule actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleEdit}>
              <Edit size={16} className="mr-2.5 text-muted-foreground" />
              Edit schedule
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onViewResults}>
              <Play size={16} className="mr-2.5 text-muted-foreground" />
              View runs
            </DropdownMenuItem>
            {sessionMode === "continuous" && (
              <DropdownMenuItem onSelect={handleReset}>
                <Share size={16} className="mr-2.5 text-muted-foreground" />
                Reset session
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              <TrashCan size={16} className="mr-2.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function CreateScheduleModal({
  agents,
  onClose,
}: {
  agents: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectAgent = useStore((s) => s.selectAgent);

  const handleSend = () => {
    if (!agentId || !prompt.trim()) return;
    selectAgent(agentId, prompt.trim());
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Modal widthClass="w-[520px]">
      <DialogHeader
        title="Create schedule"
        subtitle="Pick an agent and describe when and what it should do."
        onClose={onClose}
        divided={false}
      />

      <div className="flex flex-col gap-4 px-5 pb-5 md:px-7 md:pb-7">
        <Select
          className="h-10"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Every weekday at 9am, summarize overnight CI failures"
            rows={3}
            className={cn(
              "w-full resize-none rounded-xl border border-border bg-background px-4 py-3 pr-12 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 bottom-2 text-muted-foreground hover:text-foreground"
            disabled={!prompt.trim() || !agentId}
            onClick={handleSend}
          >
            <SendAltFilled size={16} />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
