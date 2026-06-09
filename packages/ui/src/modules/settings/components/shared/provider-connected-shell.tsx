import { Pencil, X } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import type { ProviderPresetType } from "../../../../types.js";
import { CardIcon } from "./card-icon.js";
import { IconButton } from "./icon-button.js";

/**
 * Connected-state chrome shared by every provider preset's `connected.tsx`.
 * Uses a shadcn {@link Card} so it visually matches the rest of the
 * design-branch UI (no thick borders, no brutal shadow). Each preset's
 * `connected.tsx` decides what the subtitle says (e.g. Anthropic shows
 * "Set up with OAuth Token") and whether clicking Edit transitions to its
 * specific Form.
 */
export function ProviderConnectedShell({
  provider,
  title,
  subtitle,
  onEdit,
  onRemove,
}: {
  provider: ProviderPresetType;
  title: string;
  /** Free-form node so callers can include `<span class="font-mono">`
   *  fragments etc. */
  subtitle: ReactNode;
  onEdit: () => void;
  onRemove: () => void | Promise<void>;
}) {
  return (
    <Card className="anim-in p-5">
      <div className="flex items-center gap-4">
        <CardIcon provider={provider} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-foreground mb-0.5">
            {title}
          </div>
          <div className="text-[12px] text-muted-foreground truncate">
            {subtitle}
          </div>
        </div>
        <IconButton onClick={onEdit} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </Card>
  );
}
