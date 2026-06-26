import { Add } from "@carbon/icons-react";

export interface AgentPickerItem {
  agentId: string;
  name: string;
  templateName: string | null;
}

interface Props {
  items: AgentPickerItem[];
  onAdd: (agentId: string) => void;
}

export function AgentPicker({ items, onAdd }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No more agents to add. Create a sandbox to add another arm.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <button
          key={item.agentId}
          type="button"
          onClick={() => onAdd(item.agentId)}
          className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-left transition-colors hover:border-foreground/20"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Add size={14} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {item.name}
            </span>
            {item.templateName && (
              <span className="block truncate text-[12px] text-muted-foreground">
                {item.templateName}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
