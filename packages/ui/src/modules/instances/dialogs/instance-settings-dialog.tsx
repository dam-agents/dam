import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "../../../components/modal.js";

export interface InstanceSettingsValues {
  allowedUserEmails: string[];
  experimentalCredentialInjector: boolean;
}

export function InstanceSettingsDialog({
  instanceName,
  allowedUserEmails,
  experimentalCredentialInjector,
  onSubmit,
  onCancel,
}: {
  instanceName: string;
  allowedUserEmails: string[];
  experimentalCredentialInjector: boolean;
  onSubmit: (values: InstanceSettingsValues) => void;
  onCancel: () => void;
}) {
  const [users, setUsers] = useState<string[]>(allowedUserEmails);
  const [input, setInput] = useState("");
  const [experimental, setExperimental] = useState<boolean>(experimentalCredentialInjector);

  const addUser = () => {
    const v = input.trim();
    if (!v || users.includes(v)) return;
    setUsers([...users, v]);
    setInput("");
  };

  const removeUser = (email: string) => setUsers(users.filter(u => u !== email));

  return (
    <Modal widthClass="w-[460px]">
      <div className="flex-1 overflow-y-auto p-5 md:p-7 flex flex-col gap-5">
        <div>
          <h2 className="text-[20px] font-bold text-text">Instance Settings</h2>
          <p className="text-[12px] text-text-muted mt-1">Instance: <span className="font-semibold text-text-secondary">{instanceName}</span></p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Allowed Users</span>
            <span className="text-[11px] text-text-muted">{users.length === 0 ? "unrestricted" : `${users.length} user${users.length !== 1 ? "s" : ""}`}</span>
          </div>
          <p className="text-[12px] text-text-muted -mt-1">User emails that can interact via Slack. Leave empty for unrestricted access.</p>

          <div className="flex gap-2">
            <input
              type="email"
              className="flex-1 h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted font-mono"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addUser()}
              placeholder="user@example.com"
              autoFocus
            />
            <button
              onClick={addUser}
              disabled={!input.trim()}
              className="btn-brutal h-10 w-10 shrink-0 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 shadow-brutal-sm"
            >
              <Plus size={14} />
            </button>
          </div>

          {users.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {users.map(email => (
                <div key={email} className="flex items-center gap-2 rounded-lg border-2 border-border-light bg-bg px-4 py-2">
                  <span className="flex-1 text-[13px] font-mono text-text truncate">{email}</span>
                  <button
                    onClick={() => removeUser(email)}
                    className="shrink-0 text-text-muted hover:text-danger transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Experimental</span>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={experimental}
              onChange={e => setExperimental(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-text">Credential injector (Envoy sidecar)</span>
              <span className="text-[12px] text-text-muted">
                Replaces OneCLI with an Envoy credential gateway for this instance. OAuth-backed services (GitHub, Slack, Google) will not work when enabled. Restart required.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            onClick={() => onSubmit({ allowedUserEmails: users, experimentalCredentialInjector: experimental })}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
