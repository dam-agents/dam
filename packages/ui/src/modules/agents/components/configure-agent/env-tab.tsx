import { KeyRound, Lock } from "lucide-react";

import { EnvVarsEditor } from "../../../../components/env-vars-editor.js";
import type { EnvVar } from "../../../../types.js";

export interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string } | { appLabel: string };
}

export function EnvTab({
  inherited,
  envVars,
  setEnvVars,
  saving,
}: {
  inherited: InheritedEnv[];
  envVars: EnvVar[];
  setEnvVars: (v: EnvVar[]) => void;
  saving: boolean;
}) {
  return (
    <>
      <p className="text-[12px] text-muted-foreground">
        Applied to every instance of this agent. Restart the instance pod to
        pick up changes.
      </p>

      {inherited.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
              Inherited
            </span>
            <span className="text-[10px] text-muted-foreground">
              · managed elsewhere
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {inherited.map((e, i) => (
              <InheritedEnvRow key={`${e.name}:${i}`} entry={e} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
          Custom
        </span>
        <EnvVarsEditor value={envVars} onChange={setEnvVars} disabled={saving} />
      </div>
    </>
  );
}

function InheritedEnvRow({ entry }: { entry: InheritedEnv }) {
  const isSystem = entry.source === "system";
  const sourceName =
    entry.source === "system"
      ? null
      : "secretName" in entry.source
        ? entry.source.secretName
        : entry.source.appLabel;
  return (
    <div className="group flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-[12px]">
      <span
        className={`shrink-0 ${isSystem ? "text-muted-foreground" : "text-primary"}`}
        title={isSystem ? "Platform-managed" : `From connection: ${sourceName}`}
      >
        {isSystem ? <Lock size={12} /> : <KeyRound size={12} />}
      </span>
      <span className="font-mono font-semibold text-foreground truncate">
        {entry.name}
      </span>
      <span className="text-muted-foreground">=</span>
      <span className="font-mono text-muted-foreground truncate flex-1" title={entry.value}>
        {entry.value}
      </span>
      {!isSystem && (
        <span className="text-[10px] text-muted-foreground italic truncate max-w-[160px]">
          {sourceName}
        </span>
      )}
    </div>
  );
}
