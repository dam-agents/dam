import { VIEWER_ALLOWLIST_MAX } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { normalizeViewerEmail } from "../lib/viewer-allowlist.js";
import { ViewerRow } from "./viewer-row.js";

const COUNTER_FROM = 40;

interface Props {
  viewers: string[];
  onChange: (viewers: string[]) => void;
  disabled: boolean;
}

function sharedWithCaption(count: number, full: boolean) {
  if (count === 0) return "Not shared with anyone yet";
  const users = count === 1 ? "user" : "users";
  if (full) return `Currently shared with ${count} ${users} · the list is full`;
  if (count >= COUNTER_FROM)
    return `Currently shared with ${count} ${users} · ${count} / ${VIEWER_ALLOWLIST_MAX}`;
  return `Currently shared with ${count} ${users}`;
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
    <div className="flex flex-col gap-2">
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
