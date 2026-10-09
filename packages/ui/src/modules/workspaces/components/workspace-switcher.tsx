import { Checkmark, Enterprise, Settings, User } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useWorkspaces } from "../api/queries.js";
import {
  currentWorkspaceId,
  switchWorkspace,
} from "../lib/current-workspace.js";

export function WorkspaceSwitcher({ expanded }: { expanded: boolean }) {
  const { data: workspaces } = useWorkspaces();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const selectedId = currentWorkspaceId();
  const selected = workspaces?.find((w) => w.id === selectedId);
  const label = selected?.name ?? "Personal";
  const Icon = selected ? Enterprise : User;

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="workspace-switcher"
        aria-label={`Workspace: ${label}`}
        className="flex h-[34px] w-full items-center gap-3 rounded-lg px-2.5 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon size={16} className="shrink-0" />
        {expanded && (
          <span className="truncate text-sm font-medium">{label}</span>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {expanded ? (
        trigger
      ) : (
        <Tooltip content={label} side="right">
          {trigger}
        </Tooltip>
      )}
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <WorkspaceItem
          name="Personal"
          icon={User}
          active={selected === undefined}
          onSelect={() => switchWorkspace(null)}
        />
        {workspaces?.map((w) => (
          <WorkspaceItem
            key={w.id}
            name={w.name}
            icon={Enterprise}
            active={w.id === selected?.id}
            onSelect={() => switchWorkspace(w.id)}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigateToSettings("workspaces")}>
          <Settings size={14} />
          Manage workspaces
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceItem({
  name,
  icon: Icon,
  active,
  onSelect,
}: {
  name: string;
  icon: typeof User;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} aria-current={active || undefined}>
      <Icon size={14} />
      <span className="flex-1 truncate">{name}</span>
      <Checkmark size={14} className={cn(!active && "invisible")} />
    </DropdownMenuItem>
  );
}
