import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MessageEditor({
  initial,
  pending,
  saveLabel = "Save",
  saveVariant = "default",
  onSave,
  onCancel,
}: {
  initial: string;
  pending: boolean;
  saveLabel?: string;
  saveVariant?: "default" | "destructive";
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const save = () => {
    if (draft.trim()) onSave(draft.trim());
  };
  return (
    <div className="flex w-full flex-col items-end gap-2">
      <Textarea
        autoFocus
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="flex gap-2">
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={saveVariant}
          disabled={pending || !draft.trim()}
          onClick={save}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
