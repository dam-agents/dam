import {
  Add,
  ArrowLeft,
  ConnectionSignal,
  OverflowMenuVertical,
  SkillLevelAdvanced,
  Time,
  Upload,
} from "@carbon/icons-react";
import type { Skill } from "api-server-api";
import { skillKey } from "api-server-api";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { emitToast } from "@/lib/toast";

import type { Schedule } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  agentConnections as mockAgentConnections,
  connectionTemplates as mockTemplates,
  connections as mockConnections,
} from "../../../mock/data/connections.js";
import { schedules as mockSchedules } from "../../../mock/data/schedules.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import {
  formatRunTime,
  scheduleCadenceText,
} from "../../schedules/lib/schedule-format.js";
import { useSkillsDerivations } from "../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../sandboxes/hooks/use-skills-surface.js";

type Panel = "menu" | "skills" | "schedules" | "connections";

interface PlusMenuProps {
  agentId: string | null;
  disabled: boolean;
  onAttachFile: () => void;
  onConfigureSection?: (section: SandboxSection) => void;
  onInsertSkillChip?: (skillName: string) => void;
  onPrefillInput?: (text: string) => void;
}

export function PlusMenuPopover({
  agentId,
  disabled,
  onAttachFile,
  onConfigureSection,
  onInsertSkillChip,
  onPrefillInput,
}: PlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setTimeout(() => setPanel("menu"), 150);
  }, []);

  const goBack = useCallback(() => setPanel("menu"), []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 mb-[9px] h-10 w-10 text-muted-foreground hover:text-primary disabled:opacity-40"
          disabled={disabled}
          aria-label="Add"
          tooltip="Add"
        >
          <Add size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[360px] max-h-[60vh] overflow-hidden p-0"
      >
        <div className="relative overflow-hidden">
          <div
            className="flex transition-transform duration-150 ease-in-out"
            style={{ transform: `translateX(${panel === "menu" ? "0" : "-100%"})` }}
          >
            <div className="w-[360px] shrink-0">
              <MenuRoot
                agentId={agentId}
                onAttachFile={() => { onAttachFile(); handleOpenChange(false); }}
                onOpenPanel={setPanel}
                hasConfigureSection={!!onConfigureSection}
              />
            </div>
            <div className="w-[360px] shrink-0 max-h-[60vh] overflow-y-auto">
              {panel === "skills" && (
                <SkillsPanel
                  agentId={agentId}
                  onBack={goBack}
                  onManage={() => { onConfigureSection?.("skills"); handleOpenChange(false); }}
                  onSkillClick={(name) => { onInsertSkillChip?.(name); handleOpenChange(false); }}
                />
              )}
              {panel === "schedules" && (
                <SchedulesPanel
                  agentId={agentId}
                  onBack={goBack}
                  onManage={() => { onConfigureSection?.("schedules"); handleOpenChange(false); }}
                  onDescribe={() => {
                    onPrefillInput?.("Create a schedule that ");
                    handleOpenChange(false);
                  }}
                  onSetup={() => { onConfigureSection?.("schedules"); handleOpenChange(false); }}
                />
              )}
              {panel === "connections" && (
                <ConnectionsPanel
                  agentId={agentId}
                  onBack={goBack}
                  onManage={() => { onConfigureSection?.("connections"); handleOpenChange(false); }}
                />
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuRoot({
  agentId,
  onAttachFile,
  onOpenPanel,
  hasConfigureSection,
}: {
  agentId: string | null;
  onAttachFile: () => void;
  onOpenPanel: (p: Panel) => void;
  hasConfigureSection: boolean;
}) {
  const skillCount = useSkillCount(agentId);
  const scheduleCount = useScheduleCount(agentId);
  const connectionCount = useConnectionCount(agentId);

  return (
    <div className="py-1">
      <MenuRow icon={<Upload size={16} />} label="Attach file" onClick={onAttachFile} />
      {hasConfigureSection && (
        <>
          <MenuRow
            icon={<SkillLevelAdvanced size={16} />}
            label="Skills"
            badge={skillCount > 0 ? `${skillCount} on` : undefined}
            onClick={() => onOpenPanel("skills")}
          />
          <MenuRow
            icon={<Time size={16} />}
            label="Schedules"
            badge={scheduleCount > 0 ? `${scheduleCount} active` : undefined}
            onClick={() => onOpenPanel("schedules")}
          />
          <MenuRow
            icon={<ConnectionSignal size={16} />}
            label="Connections"
            badge={connectionCount > 0 ? `${connectionCount}` : undefined}
            onClick={() => onOpenPanel("connections")}
          />
        </>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <Badge variant="muted" size="sm" className="shrink-0">
          {badge}
        </Badge>
      )}
    </button>
  );
}

function PanelHeader({
  title,
  onBack,
  manageLabel,
  onManage,
}: {
  title: string;
  onBack: () => void;
  manageLabel?: string;
  onManage?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2.5">
      <button
        type="button"
        onClick={onBack}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
      </button>
      <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
      {onManage && (
        <button
          type="button"
          onClick={onManage}
          className="text-sm text-accent transition-colors hover:text-accent/80"
        >
          {manageLabel ?? "Manage"}
        </button>
      )}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="px-3 py-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        autoFocus
      />
    </div>
  );
}

function PanelEmpty({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="flex-1" />
          <div className="h-5 w-9 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SkillsPanel({
  agentId,
  onBack,
  onManage,
  onSkillClick,
}: {
  agentId: string | null;
  onBack: () => void;
  onManage: () => void;
  onSkillClick: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const surface = useSkillsSurface(agentId, {
    readOnly: false,
    isError: false,
  });
  const derived = useSkillsDerivations(surface, {
    readOnly: false,
    query,
  });

  const {
    sources,
    sourcesLoaded,
    stateLoaded,
    skillsBySource,
    installedRef,
    mutationsDisabled,
    busyKey,
    standalone,
  } = surface;

  const { shownSources, totals } = derived;

  const loaded = sourcesLoaded && stateLoaded;
  const totalSkills = totals.skills;

  return (
    <div className="flex flex-col">
      <PanelHeader title="Skills" onBack={onBack} onManage={onManage} />
      {totalSkills > 6 && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search skills..." />
      )}
      {!loaded ? (
        <SkeletonRows />
      ) : sources.length === 0 && standalone.length === 0 ? (
        <PanelEmpty
          message="No skills configured yet"
          action={
            <Button variant="outline" size="sm" onClick={onManage}>
              <Add size={16} /> Add skill
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {standalone.length > 0 && (
            <SkillGroup label="Created in this agent">
              {standalone.map((s) => (
                <SkillPanelRow
                  key={s.name}
                  name={s.name}
                  installed
                  alwaysOn
                  busy={false}
                  disabled={false}
                  onToggle={() => {}}
                  onClick={() => onSkillClick(s.name)}
                />
              ))}
            </SkillGroup>
          )}
          {shownSources.map((src) => {
            const skills = skillsBySource[src.id] ?? [];
            if (skills.length === 0) return null;
            return (
              <SkillGroup key={src.id} label={src.name}>
                {skills.map((skill) => {
                  const installed = installedRef(skill.source, skill.name) !== undefined;
                  const busy = busyKey === skillKey(skill);
                  return (
                    <SkillPanelRow
                      key={skillKey(skill)}
                      name={skill.name}
                      installed={installed}
                      busy={busy}
                      disabled={mutationsDisabled}
                      onToggle={() => void surface.toggle(skill)}
                      onClick={() => onSkillClick(skill.name)}
                    />
                  );
                })}
              </SkillGroup>
            );
          })}
        </div>
      )}
      <div className="sticky bottom-0 border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onManage}>
          <Add size={16} /> Add skill
        </Button>
      </div>
    </div>
  );
}

function SkillGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function SkillPanelRow({
  name,
  installed,
  alwaysOn,
  busy,
  disabled,
  onToggle,
  onClick,
}: {
  name: string;
  installed: boolean;
  alwaysOn?: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-muted/60",
        installed && !alwaysOn && "bg-muted/40",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline"
        title={`Using ${name}`}
      >
        {name}
      </button>
      {busy && <Spinner size={14} />}
      {alwaysOn ? (
        <span className="text-[11px] text-muted-foreground">Always on</span>
      ) : (
        <Switch
          checked={installed}
          onCheckedChange={() => onToggle()}
          label={`${installed ? "Disable" : "Enable"} ${name}`}
          className={cn((disabled || busy) && "pointer-events-none opacity-50")}
        />
      )}
    </div>
  );
}

function SchedulesPanel({
  agentId,
  onBack,
  onManage,
  onDescribe,
  onSetup,
}: {
  agentId: string | null;
  onBack: () => void;
  onManage: () => void;
  onDescribe: () => void;
  onSetup: () => void;
}) {
  const [query, setQuery] = useState("");
  const schedules = useAgentSchedules(agentId);

  const filtered = useMemo(() => {
    if (!query.trim()) return schedules;
    const q = query.toLowerCase();
    return schedules.filter((s) => s.name.toLowerCase().includes(q));
  }, [schedules, query]);

  return (
    <div className="flex flex-col">
      <PanelHeader title="Schedules" onBack={onBack} onManage={onManage} />
      {schedules.length > 6 && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search schedules..." />
      )}
      {schedules.length === 0 ? (
        <PanelEmpty
          message="No schedules yet"
          action={
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Describe what you need and the agent will set one up
              </p>
              <Button variant="outline" size="sm" onClick={onDescribe}>
                Describe it
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <PanelEmpty message={`No schedules match "${query}"`} />
      ) : (
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {filtered.map((s) => (
            <SchedulePanelRow key={s.id} schedule={s} />
          ))}
        </div>
      )}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onDescribe}>
          Describe it
        </Button>
        <Button variant="ghost" size="sm" onClick={onSetup}>
          Set it up myself
        </Button>
      </div>
    </div>
  );
}

function SchedulePanelRow({ schedule }: { schedule: Schedule }) {
  const [enabled, setEnabled] = useState(schedule.enabled);

  const cadence = scheduleCadenceText(schedule);
  const nextRun = schedule.status?.nextRun
    ? formatRunTime(schedule.status.nextRun)
    : null;
  const subtitle = [cadence, nextRun ? `Next ${nextRun}` : null]
    .filter(Boolean)
    .join(" · ");

  const handleToggle = useCallback(
    (on: boolean) => {
      setEnabled(on);
      emitToast({
        kind: "info",
        message: `Schedule updated — ${schedule.name} ${on ? "enabled" : "disabled"}`,
      });
    },
    [schedule.name],
  );

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{schedule.name}</p>
        <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <ScheduleOverflowMenu schedule={schedule} />
      <Switch
        checked={enabled}
        onCheckedChange={handleToggle}
        label={`${enabled ? "Disable" : "Enable"} schedule`}
      />
    </div>
  );
}

function ScheduleOverflowMenu({ schedule }: { schedule: Schedule }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Schedule actions"
        >
          <OverflowMenuVertical size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem>Edit schedule</DropdownMenuItem>
        <DropdownMenuItem>View results</DropdownMenuItem>
        {schedule.sessionMode === "continuous" && (
          <DropdownMenuItem>Reset session</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() =>
            emitToast({ kind: "info", message: `Schedule deleted — ${schedule.name}` })
          }
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionsPanel({
  agentId,
  onBack,
  onManage,
}: {
  agentId: string | null;
  onBack: () => void;
  onManage: () => void;
}) {
  const [query, setQuery] = useState("");
  const { granted, available, loaded } = useAgentConnections(agentId);

  const allConns = [...granted, ...available];
  const q = query.toLowerCase();
  const filteredGranted = q
    ? granted.filter((c) => c.name.toLowerCase().includes(q))
    : granted;
  const filteredAvailable = q
    ? available.filter((c) => c.name.toLowerCase().includes(q))
    : available;

  return (
    <div className="flex flex-col">
      <PanelHeader title="Connections" onBack={onBack} onManage={onManage} />
      {allConns.length > 6 && (
        <SearchInput value={query} onChange={setQuery} placeholder="Search connections..." />
      )}
      {!loaded ? (
        <SkeletonRows />
      ) : allConns.length === 0 ? (
        <PanelEmpty
          message="No connections configured"
          action={
            <Button variant="outline" size="sm" onClick={onManage}>
              <Add size={16} /> Add connection
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {filteredGranted.length > 0 && (
            <ConnectionGroup label="On for this agent">
              {filteredGranted.map((c) => (
                <ConnectionPanelRow
                  key={c.id}
                  connection={c}
                  granted
                />
              ))}
            </ConnectionGroup>
          )}
          {filteredAvailable.length > 0 && (
            <ConnectionGroup label="Available">
              {filteredAvailable.map((c) => (
                <ConnectionPanelRow
                  key={c.id}
                  connection={c}
                  granted={false}
                />
              ))}
            </ConnectionGroup>
          )}
          {filteredGranted.length === 0 && filteredAvailable.length === 0 && (
            <PanelEmpty message={`No connections match "${query}"`} />
          )}
        </div>
      )}
      <div className="sticky bottom-0 border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onManage}>
          <Add size={16} /> Add connection
        </Button>
      </div>
    </div>
  );
}

function ConnectionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

interface MockConnection {
  id: string;
  templateId: string;
  name: string;
  status: string;
  iconSlug?: string;
}

function ConnectionPanelRow({
  connection,
  granted,
}: {
  connection: MockConnection;
  granted: boolean;
}) {
  const [isGranted, setIsGranted] = useState(granted);

  const iconSlug = useConnectionIconSlug(connection.templateId);
  const isBroken = connection.status === "expired" || connection.status === "disconnected";

  const handleToggle = useCallback(
    (on: boolean) => {
      setIsGranted(on);
      emitToast({
        kind: "info",
        message: `Connection updated — ${connection.name} ${on ? "granted" : "removed"}`,
      });
    },
    [connection.name],
  );

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-muted/60">
      <ConnectionIcon iconSlug={iconSlug} alt={connection.name} size={16} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {connection.name}
      </span>
      {isBroken && (
        <Badge
          variant={connection.status === "expired" ? "warning" : "danger"}
          size="sm"
        >
          {connection.status === "expired" ? "Expired" : "Disconnected"}
        </Badge>
      )}
      {connection.status === "pending" && (
        <Badge variant="muted" size="sm">
          Pending
        </Badge>
      )}
      <Switch
        checked={isGranted}
        onCheckedChange={handleToggle}
        label={`${isGranted ? "Remove" : "Grant"} ${connection.name}`}
      />
    </div>
  );
}

function useSkillCount(agentId: string | null): number {
  const surface = useSkillsSurface(agentId, {
    readOnly: true,
    isError: false,
  });
  const derived = useSkillsDerivations(surface, {
    readOnly: true,
    query: "",
  });
  return derived.totals.on;
}

function useScheduleCount(agentId: string | null): number {
  const schedules = useAgentSchedules(agentId);
  return schedules.filter((s) => s.enabled).length;
}

function useConnectionCount(agentId: string | null): number {
  return mockAgentConnections.length;
}

function useAgentSchedules(agentId: string | null): Schedule[] {
  return useMemo(() => {
    if (!agentId) return [];
    return (mockSchedules as unknown as Schedule[]).filter(
      (s) => s.agentId === agentId,
    );
  }, [agentId]);
}

function useAgentConnections(_agentId: string | null) {
  return useMemo(() => {
    const grantedIds = new Set(mockAgentConnections.map((c) => c.id));
    const granted: MockConnection[] = mockAgentConnections as MockConnection[];
    const available: MockConnection[] = (mockConnections as MockConnection[]).filter(
      (c) => !grantedIds.has(c.id),
    );
    return { granted, available, loaded: true };
  }, []);
}

function useConnectionIconSlug(templateId: string): string | undefined {
  return useMemo(() => {
    const tpl = mockTemplates.find((t) => t.id === templateId);
    return tpl?.iconSlug;
  }, [templateId]);
}
