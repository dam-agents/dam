import { Pencil, X } from "lucide-react";
import type { ReactNode } from "react";

import { CardIcon } from "./card-icon.js";
import { IconButton } from "./icon-button.js";

/**
 * Connected-state chrome shared by every provider preset's `connected.tsx`.
 * Handles the rounded-xl card, CardIcon, title/subtitle slots, and the
 * Edit + Remove icon buttons. Each preset's `connected.tsx` decides what
 * the subtitle says (e.g. Anthropic shows "Set up with OAuth Token";
 * IBM LiteLLM shows the current default model) and whether clicking
 * Edit transitions to its specific Form.
 */
export function ProviderConnectedShell({
  title,
  subtitle,
  onEdit,
  onRemove,
}: {
  title: string;
  /** Free-form node so callers can include `<span class="font-mono">`
   *  fragments etc. (IBM LiteLLM displays its current default model with
   *  monospace formatting). */
  subtitle: ReactNode;
  onEdit: () => void;
  onRemove: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in shadow-brutal-accent">
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text mb-0.5">{title}</div>
          <div className="text-[12px] text-text-muted truncate">{subtitle}</div>
        </div>
        <IconButton onClick={onEdit} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}
