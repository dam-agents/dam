import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  type ProviderPresetType,
  PROVIDERS,
  type SecretView,
} from "../../../types.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";

interface Props {
  type: ProviderPresetType;
  description: string;
  secret: SecretView | undefined;
  selected: boolean;
  onConnect: () => void;
  onSelect: () => void;
  onEditKey: () => void;
  onRemoveKey: () => void;
}

export function ProviderRow({
  type,
  description,
  secret,
  selected,
  onConnect,
  onSelect,
  onEditKey,
  onRemoveKey,
}: Props) {
  const name = PROVIDERS[type].displayName;

  if (!secret) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <CardIcon provider={type} />
        <ProviderText name={name} description={description} />
        <span className="shrink-0 text-[13px] font-medium text-foreground">
          Connect
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border bg-card pr-2 transition-colors",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <CardIcon provider={type} />
        <ProviderText name={name} description={description} connected />
      </button>
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
        <p className="text-[14px] font-semibold text-foreground">{name}</p>
        {connected && (
          <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-medium text-success">
            Connected
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground">{description}</p>
    </div>
  );
}
