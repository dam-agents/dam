import { Pencil, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { SecretView } from "../../../../types.js";
import { CardIcon } from "./card-icon.js";
import { AnthropicForm } from "./form.js";
import { detectMode, type Mode,MODES } from "./modes.js";

export function AnthropicConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
}) {
  const currentMode = detectMode(secret.envMappings?.[0]?.envName);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AnthropicForm
        variant="edit"
        initialMode={currentMode}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          await onSave(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 anim-in shadow-sm">
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-foreground mb-0.5">Anthropic</div>
          <div className="text-[12px] text-muted-foreground">
            Set up with {MODES[currentMode].label}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setEditing(true)}
          title="Edit"
        >
          <Pencil size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-destructive"
          onClick={onRemove}
          title="Remove"
        >
          <X size={13} />
        </Button>
      </div>
    </div>
  );
}
