import { Lock, Pencil, X } from "lucide-react";

import { useStore } from "../../../store.js";
import type { SecretView } from "../../../types.js";
import { useDeleteSecret } from "../../secrets/api/mutations.js";

interface Props {
  secret: SecretView;
  animationDelayMs: number;
  onEdit: (secret: SecretView) => void;
}

export function SecretRow({ secret, animationDelayMs, onEdit }: Props) {
  const { id, name, hostPattern, pathPattern, envMappings } = secret;
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteSecret = useDeleteSecret();

  const handleRemove = async () => {
    if (!(await showConfirm(`Delete "${name}"?`, "Delete Secret"))) return;
    deleteSecret.mutate({ id });
  };

  return (
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] shadow-brutal anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        <Lock size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">
          {name}
        </div>
        <div className="text-[12px] font-mono text-text-muted truncate">
          {hostPattern}
          {pathPattern && (
            <span className="text-text-secondary">{pathPattern}</span>
          )}
          {envMappings && envMappings.length > 0 && (
            <>
              {" · "}
              <span className="text-accent">
                {envMappings.map((m) => m.envName).join(", ")}
              </span>
            </>
          )}
        </div>
      </div>
      <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 bg-surface-raised text-text-muted border-border-light">
        Secret
      </span>
      <button
        onClick={() => onEdit(secret)}
        className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-accent hover:border-accent shadow-brutal-sm"
        title="Edit"
      >
        <Pencil size={13} />
      </button>
      <button
        onClick={handleRemove}
        className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger shadow-brutal-sm"
        title="Remove"
      >
        <X size={13} />
      </button>
    </div>
  );
}
