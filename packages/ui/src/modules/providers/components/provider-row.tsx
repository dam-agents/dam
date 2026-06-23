import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { CardIcon } from "./card-icon.js";

interface Props {
  type: ProviderPresetType;
  description: string;
  subtitle?: string;
  connected: boolean;
  selected: boolean;
  selectable?: boolean;
  onConnect: () => void;
  onSelect: () => void;
  onEditKey: () => void;
  onRemoveKey: () => void;
}

export function ProviderRow({
  type,
  description,
  subtitle,
  connected,
  selected,
  selectable = true,
  onConnect,
  onSelect,
  onEditKey,
  onRemoveKey,
}: Props) {
  const name = PROVIDERS[type].displayName;

  if (!connected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
      >
        <CardIcon provider={type} />
        <ProviderText name={name} description={description} />
        <span className="shrink-0 text-[14px] font-normal text-muted-foreground">
          Connect
        </span>
      </button>
    );
  }

  const info = (
    <>
      <CardIcon provider={type} />
      <ProviderText
        name={name}
        description={subtitle ?? description}
        connected
      />
    </>
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border bg-card pr-2 transition-colors",
        selectable && selected ? "border-foreground" : "border-border",
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-4 text-left transition-colors hover:bg-muted/30"
        >
          {info}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4">
          {info}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="Provider actions">
            <MoreVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEditKey}>Edit key</DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={onRemoveKey}>
            Remove key
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return (
    <div className="h-[72px] rounded-lg border border-border bg-card anim-pulse" />
  );
};

function ProviderText({
  name,
  description,
  connected = false,
}: {
  name: string;
  description: string;
  connected?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <p className="text-[16px] font-medium text-foreground">{name}</p>
        {connected && (
          <span className="rounded-full bg-success-light px-2.5 py-0.5 text-[12px] font-normal text-success">
            Connected
          </span>
        )}
      </div>
      <p className="text-[14px] text-muted-foreground">{description}</p>
    </div>
  );
}
