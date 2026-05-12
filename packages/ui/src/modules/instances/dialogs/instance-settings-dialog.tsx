import {
  Add as Plus,
  Close as X,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface InstanceSettingsValues {
  allowedUserEmails: string[];
}

export function InstanceSettingsDialog({
  instanceName,
  allowedUserEmails,
  onSubmit,
  onCancel,
}: {
  instanceName: string;
  allowedUserEmails: string[];
  onSubmit: (values: InstanceSettingsValues) => void;
  onCancel: () => void;
}) {
  const [users, setUsers] = useState<string[]>(allowedUserEmails);
  const [input, setInput] = useState("");

  const addUser = () => {
    const v = input.trim();
    if (!v || users.includes(v)) return;
    setUsers([...users, v]);
    setInput("");
  };

  const removeUser = (email: string) => setUsers(users.filter(u => u !== email));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-[460px] gap-5">
        <DialogHeader>
          <DialogTitle className="text-[20px]">Instance Settings</DialogTitle>
          <p className="text-[12px] text-muted-foreground">
            Instance: <span className="font-semibold text-foreground/80">{instanceName}</span>
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-foreground/80 uppercase tracking-[0.03em]">
              Allowed Users
            </span>
            <span className="text-[11px] text-muted-foreground">
              {users.length === 0 ? "unrestricted" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground -mt-1">
            User emails that can interact via Slack. Leave empty for unrestricted access.
          </p>

          <div className="flex gap-2">
            <Input
              type="email"
              className="flex-1 font-mono"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addUser()}
              placeholder="user@example.com"
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addUser}
              disabled={!input.trim()}
              className="shrink-0"
            >
              <Plus size={14} />
            </Button>
          </div>

          {users.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {users.map(email => (
                <div
                  key={email}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2"
                >
                  <span className="flex-1 text-[13px] font-mono text-foreground truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => removeUser(email)}
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit({ allowedUserEmails: users })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
