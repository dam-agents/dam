import {
  Add,
  ArrowLeft,
  OverflowMenuVertical,
  Pause,
  Search,
  Time,
} from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { schedules as mockSchedules } from "../../../mock/data/schedules.js";
import type { Schedule } from "../../../types.js";
import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgentConnections } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../connections/components/connection-catalog-modal.js";
import { ConnectionGroupCard } from "../../connections/components/connection-group-card.js";
import { ConnectionMaintenanceDialog } from "../../connections/components/connection-update-credential-dialog.js";
import { useCatalogGroups } from "../../connections/hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../../connections/hooks/use-connection-maintenance.js";
import type { CatalogProviderGroup } from "../../connections/lib/catalog-providers.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { SkillsSurface } from "../../sandboxes/components/skills/skills-surface.js";
import { useSkillsDerivations } from "../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../sandboxes/hooks/use-skills-surface.js";
import { excludeProviderConnections } from "../../sandboxes/lib/provider-connections.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import {
  formatRunTime,
  scheduleCadenceText,
} from "../../schedules/lib/schedule-format.js";

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
  const [catalogOpen, setCatalogOpen] = useState(false);

  const maintenance = useConnectionMaintenance();

  const connectionsQ = useAppConnections();
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();

  const grantedIds = useMemo(
    () =>
      new Set(
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [agentConnectionsQ.data],
  );

  const toggleGrant = useCallback(
    (id: string, on: boolean) => {
      if (!agentId) return;
      const current =
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
      const next = on
        ? [...new Set([...current, id])]
        : current.filter((x) => x !== id);
      setConnections.mutate({ agentId, connectionIds: next });
    },
    [agentId, agentConnectionsQ.data, setConnections],
  );

  const granted = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );

  const { populated: groups, templateById } = useCatalogGroups(granted);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setTimeout(() => setPanel("menu"), 150);
  }, []);

  const goBack = useCallback(() => setPanel("menu"), []);

  const openCatalog = useCallback(() => {
    handleOpenChange(false);
    setTimeout(() => setCatalogOpen(true), 150);
  }, [handleOpenChange]);

  return (
    <>
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
              style={{
                transform: `translateX(${panel === "menu" ? "0" : "-100%"})`,
              }}
            >
              <div className="w-[360px] shrink-0">
                <MenuRoot
                  agentId={agentId}
                  onAttachFile={() => {
                    onAttachFile();
                    handleOpenChange(false);
                  }}
                  onOpenPanel={setPanel}
                  hasConfigureSection={!!onConfigureSection}
                  connectionCount={granted.length}
                  connectionHasBroken={granted.some(
                    (c) =>
                      c.status === "expired" || c.status === "disconnected",
                  )}
                />
              </div>
              <div className="w-[360px] shrink-0 max-h-[60vh] overflow-y-auto">
                {panel === "skills" && (
                  <SkillsPanel
                    agentId={agentId}
                    onBack={goBack}
                    onManage={() => {
                      onConfigureSection?.("skills");
                      handleOpenChange(false);
                    }}
                    onSkillClick={(name) => {
                      onInsertSkillChip?.(name);
                      handleOpenChange(false);
                    }}
                    onDescribe={() => {
                      onPrefillInput?.("Create a skill that...");
                      handleOpenChange(false);
                    }}
                  />
                )}
                {panel === "schedules" && (
                  <SchedulesPanel
                    agentId={agentId}
                    onBack={goBack}
                    onManage={() => {
                      onConfigureSection?.("schedules");
                      handleOpenChange(false);
                    }}
                    onDescribe={() => {
                      onPrefillInput?.("Every morning at 9am...");
                      handleOpenChange(false);
                    }}
                    onSetup={() => {
                      onConfigureSection?.("schedules");
                      handleOpenChange(false);
                    }}
                  />
                )}
                {panel === "connections" && (
                  <ConnectionsPanel
                    groups={groups}
                    templateById={templateById}
                    onToggleGrant={toggleGrant}
                    maintenance={maintenance}
                    loaded={
                      !connectionsQ.isPending && !agentConnectionsQ.isPending
                    }
                    onBack={goBack}
                    onManage={() => {
                      onConfigureSection?.("connections");
                      handleOpenChange(false);
                    }}
                    onOpenCatalog={openCatalog}
                  />
                )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: toggleGrant }}
        />
      )}
      <ConnectionMaintenanceDialog maintenance={maintenance} />
    </>
  );
}

function MenuRoot({
  agentId,
  onAttachFile,
  onOpenPanel,
  hasConfigureSection,
  connectionCount,
  connectionHasBroken,
}: {
  agentId: string | null;
  onAttachFile: () => void;
  onOpenPanel: (p: Panel) => void;
  hasConfigureSection: boolean;
  connectionCount: number;
  connectionHasBroken: boolean;
}) {
  const skillCount = useSkillCount(agentId);
  const scheduleCount = useScheduleCount(agentId);

  return (
    <div className="py-1">
      <MenuRow label="Attach file" onClick={onAttachFile} />
      {hasConfigureSection && (
        <>
          <MenuRow
            label="Skills"
            badge={skillCount > 0 ? `${skillCount} on` : undefined}
            onClick={() => onOpenPanel("skills")}
          />
          <MenuRow
            label="Schedules"
            badge={scheduleCount > 0 ? `${scheduleCount} active` : undefined}
            onClick={() => onOpenPanel("schedules")}
          />
          <MenuRow
            label="Connections"
            badge={connectionCount > 0 ? `${connectionCount}` : undefined}
            badgeDanger={connectionHasBroken}
            onClick={() => onOpenPanel("connections")}
          />
        </>
      )}
    </div>
  );
}

function MenuRow({
  label,
  badge,
  badgeDanger,
  onClick,
}: {
  label: string;
  badge?: string;
  badgeDanger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span className="flex-1 text-left">{label}</span>
      {badge && (
        <Badge
          variant={badgeDanger ? "danger" : "muted"}
          size="sm"
          className="shrink-0"
        >
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
      <span className="flex-1 text-sm font-semibold text-foreground">
        {title}
      </span>
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
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
          autoFocus
        />
      </div>
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
  onDescribe,
}: {
  agentId: string | null;
  onBack: () => void;
  onManage: () => void;
  onSkillClick: (name: string) => void;
  onDescribe: () => void;
}) {
  return (
    <div className="flex flex-col">
      <PanelHeader title="Skills" onBack={onBack} onManage={onManage} />
      <div className="px-3 pt-2 pb-3">
        <SkillsSurface
          agentId={agentId}
          agentState="running"
          readOnly={false}
        />
      </div>
      <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onManage}>
          <Add size={16} /> Add source
        </Button>
        <button
          onClick={onDescribe}
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Or, describe to create
        </button>
      </div>
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
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search schedules..."
        />
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
        <div className="flex flex-col gap-1.5 px-2 py-2">
          {filtered.map((s) => (
            <SchedulePanelRow key={s.id} schedule={s} />
          ))}
        </div>
      )}
      <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onSetup}>
          <Add size={16} /> Add schedule
        </Button>
        <button
          onClick={onDescribe}
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Or, describe to create
        </button>
      </div>
    </div>
  );
}

function SchedulePanelRow({ schedule }: { schedule: Schedule }) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [editing, setEditing] = useState(false);

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
    <>
      <div
        className={cn(
          CARD_SURFACE,
          CARD_HOVER,
          "group flex items-center gap-3 rounded-xl px-3 py-2.5",
        )}
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            enabled
              ? "bg-blue-100/50 text-accent dark:bg-blue-950/50"
              : "bg-muted text-muted-foreground",
          )}
        >
          {enabled ? <Time size={16} /> : <Pause size={16} />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {schedule.name}
          </p>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            label={enabled ? "Disable schedule" : "Enable schedule"}
          />
          <ScheduleOverflowMenu onEdit={() => setEditing(true)} />
        </div>
      </div>

      {editing && (
        <ScheduleFormModal
          existing={schedule}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  );
}

function ScheduleOverflowMenu({ onEdit }: { onEdit: () => void }) {
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
        <DropdownMenuItem onSelect={onEdit}>Edit schedule</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionsPanel({
  groups,
  templateById,
  onToggleGrant,
  maintenance,
  loaded,
  onBack,
  onManage,
  onOpenCatalog,
}: {
  groups: CatalogProviderGroup[];
  templateById: Map<string, ConnectionTemplateView>;
  onToggleGrant: (id: string, on: boolean) => void;
  maintenance: ReturnType<typeof useConnectionMaintenance>;
  loaded: boolean;
  onBack: () => void;
  onManage: () => void;
  onOpenCatalog: () => void;
}) {
  const [query, setQuery] = useState("");

  const totalConnections = groups.reduce((n, g) => n + g.connections.length, 0);

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        connections: g.connections.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            g.provider.title.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.connections.length > 0);
  }, [groups, query]);

  return (
    <div className="flex flex-col">
      <PanelHeader title="Connections" onBack={onBack} onManage={onManage} />
      {totalConnections > 6 && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search connections..."
        />
      )}
      {!loaded ? (
        <SkeletonRows />
      ) : totalConnections === 0 ? (
        <PanelEmpty
          message="No connections configured"
          action={
            <Button variant="outline" size="sm" onClick={onOpenCatalog}>
              <Add size={16} /> Add connection
            </Button>
          }
        />
      ) : filteredGroups.length === 0 ? (
        <PanelEmpty message={`No connections match "${query}"`} />
      ) : (
        <div className="flex flex-col gap-3 px-2 py-2">
          {filteredGroups.map((group) => (
            <ConnectionGroupCard
              key={group.provider.id}
              group={group}
              templateById={templateById}
              showCount
              grant={(c) => ({
                granted: true,
                onToggle: (on) => onToggleGrant(c.id, on),
                actionHidden: true,
              })}
              maintenance={maintenance.rowActions}
            />
          ))}
        </div>
      )}
      <div className="sticky bottom-0 border-t border-border bg-background px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={onOpenCatalog}>
          <Add size={16} /> Add connection
        </Button>
      </div>
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

function useAgentSchedules(agentId: string | null): Schedule[] {
  return useMemo(() => {
    if (!agentId) return [];
    return (mockSchedules as unknown as Schedule[]).filter(
      (s) => s.agentId === agentId,
    );
  }, [agentId]);
}
