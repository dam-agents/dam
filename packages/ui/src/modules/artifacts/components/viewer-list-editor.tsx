import { VIEWER_ALLOWLIST_MAX } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { normalizeViewerEmail } from "../lib/viewer-allowlist.js";
import { ViewerChip } from "./viewer-chip.js";

const COUNTER_FROM = 40;

interface Props {
  viewers: string[];
  onChange: (viewers: string[]) => void;
  disabled: boolean;
}

export function ViewerListEditor({ viewers, onChange, disabled }: Props) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const full = viewers.length >= VIEWER_ALLOWLIST_MAX;

  function handleAdd() {
    const email = normalizeViewerEmail(draft);
    if (!email) {
      setInvalid(draft.trim().length > 0);
      return;
    }
    if (!viewers.includes(email)) onChange([...viewers, email]);
    setDraft("");
    setInvalid(false);
  }

  function handleRemove(email: string) {
    onChange(viewers.filter((v) => v !== email));
  }

  return (
    <div className="ml-6 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="email"
          size="sm"
          placeholder="name@company.com"
          aria-label="Viewer email address"
          value={draft}
          variant={invalid ? "invalid" : "standard"}
          disabled={disabled || full}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          data-testid="viewer-email-input"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || full || draft.trim().length === 0}
          onClick={handleAdd}
        >
          + Add
        </Button>
      </div>
      {invalid && (
        <p className="text-xs text-danger">Enter a full email address</p>
      )}
      {viewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nobody is on the list yet. Only you can open the link until you add
          someone.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" data-testid="viewer-list">
          {viewers.map((email) => (
            <ViewerChip
              key={email}
              email={email}
              onRemove={handleRemove}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      {viewers.length >= COUNTER_FROM && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {viewers.length} / {VIEWER_ALLOWLIST_MAX}
          {full && " — the list is full"}
        </p>
      )}
    </div>
  );
}
