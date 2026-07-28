import { OverflowMenuVertical } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { CardIcon } from "./card-icon.js";

interface Props {
  type: ProviderPresetType;
  description: string;
  connected: boolean;
  onConnect: () => void;
  onEditKey: () => void;
  onRemoveKey: () => void;
}

export function ProviderRow({
  type,
  description,
  connected,
  onConnect,
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

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card pr-2 transition-colors">
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4">
        <CardIcon provider={type} />
        <ProviderText name={name} description={description} connected />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${name}`}
          >
            <OverflowMenuVertical size={16} />
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
{connected && <Badge variant="success">Connected</Badge>}
      </div>
      <p className="text-[14px] text-muted-foreground">{description}</p>
    </div>
  );
}
