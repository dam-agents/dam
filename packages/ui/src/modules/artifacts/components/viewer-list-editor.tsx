import { VIEWER_ALLOWLIST_MAX } from "api-server-api";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { normalizeViewerEmail } from "../lib/viewer-allowlist.js";
import { ViewerRow } from "./viewer-row.js";

interface Props {
  viewers: string[];
  onChange: (viewers: string[]) => void;
  disabled: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
}

function sharedWithCaption(count: number, full: boolean) {
  if (count === 0) return "Only you can open the link. Add people to share it.";
  return `${count} / ${VIEWER_ALLOWLIST_MAX} people on the list${full ? " · the list is full" : ""}`;
}

export function ViewerListEditor({
  viewers,
  onChange,
  disabled,
  draft,
  onDraftChange,
}: Props) {
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const full = viewers.length >= VIEWER_ALLOWLIST_MAX;

  function handleAdd() {
    if (disabled || full) return;
    const email = normalizeViewerEmail(draft);
    if (!email) {
      setError(draft.trim().length > 0 ? "Enter a full email address" : null);
      return;
    }
    if (viewers.includes(email)) {
      setError("This person is already on the list");
      return;
    }
    onChange([...viewers, email]);
    onDraftChange("");
    setError(null);
  }

  function handleRemove(email: string) {
    onChange(viewers.filter((v) => v !== email));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="email"
          size="sm"
          placeholder="name@company.com"
          aria-label="Viewer email address"
          value={draft}
          variant={error ? "invalid" : "standard"}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled || full}
          onChange={(e) => {
            onDraftChange(e.target.value);
            setError(null);
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
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground tabular-nums">
        {sharedWithCaption(viewers.length, full)}
      </p>
      {viewers.length > 0 && (
        <ul
          className="-ml-1 max-h-24 overflow-y-auto pr-1"
          data-testid="viewer-list"
        >
          {viewers.map((email) => (
            <ViewerRow
              key={email}
              email={email}
              onRemove={handleRemove}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
