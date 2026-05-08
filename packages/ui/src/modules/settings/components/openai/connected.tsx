import { Pencil, X } from "lucide-react";
import { useState } from "react";

import { PROVIDERS, type SecretView } from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { OpenAIForm } from "./form.js";

export function OpenAIConnected({
  onRemove,
  onSave,
}: {
  /** Currently unused — the connected card has no per-secret state to
   *  display beyond "API key configured." Kept on the prop type for
   *  symmetry with the other preset cards (and so callers can be wired
   *  identically in `providers-view.tsx`). */
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { value: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <OpenAIForm
        variant="edit"
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          await onSave(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in shadow-brutal-accent">
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text mb-0.5">{PROVIDERS.openai.displayName}</div>
          <div className="text-[12px] text-text-muted">
            API key configured.
          </div>
        </div>
        <IconButton onClick={() => setEditing(true)} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}
