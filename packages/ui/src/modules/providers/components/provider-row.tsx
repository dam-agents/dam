import { OverflowMenuVertical } from "@carbon/icons-react";
import type { HarnessFamily } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  harnesses?: readonly HarnessFamily[];
  connected: boolean;
  balance?: ReactNode;
  onConnect: () => void;
  onEditKey: () => void;
  onRemoveKey: () => void;
}

export function ProviderRow({
  type,
  harnesses,
  connected,
  balance,
  onConnect,
  onEditKey,
  onRemoveKey,
}: Props) {
  const name = PROVIDERS[type].displayName;

  return (
    <Card className="flex items-center gap-3 p-4">
      <CardIcon provider={type} />
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-2">
          <p
            className="truncate text-base font-medium text-foreground"
            title={name}
          >
            {name}
          </p>
          {connected && (
            <Badge variant="success" className="shrink-0">
              Connected
            </Badge>
          )}
          <div className="ml-auto shrink-0">
            {connected ? (
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
                  <DropdownMenuItem onSelect={onEditKey}>
                    Edit key
                  </DropdownMenuItem>
                  <DropdownMenuItem tone="danger" onSelect={onRemoveKey}>
                    Remove key
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onConnect}
                aria-label={`Connect ${name}`}
              >
                Connect
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">supports:</span>
            {harnesses?.length ? (
              <HarnessIcons harnesses={harnesses} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">
                {harnesses ? "None" : "Compatibility unavailable"}
              </span>
            )}
          </div>
          <div className="min-w-0 text-right">{balance}</div>
        </div>
      </div>
    </Card>
  );
}

ProviderRow.Skeleton = function ProviderRowSkeleton() {
  return <Card className="h-[92px] animate-pulse" />;
};
