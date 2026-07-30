import { Key, Locked, WarningAlt } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { EnvVarsEditor } from "../../../../components/env-vars-editor.js";
import type { EnvVar } from "../../../../types.js";

export interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string } | { appLabel: string };
}

// Inherited entries that a user-typed env shadows by name.
// User-typed wins on collision; this surfaces the shadow so it isn't silent.
// System entries (PORT etc.) are excluded — those have their own protection.
function shadowWarnings(
  envVars: EnvVar[],
  inherited: InheritedEnv[],
): { envName: string; shadowedSource: string }[] {
  const sourceLabelByName = new Map<string, string>();
  for (const i of inherited) {
    if (i.source === "system") continue;
    sourceLabelByName.set(
      i.name,
      "secretName" in i.source
        ? `secret "${i.source.secretName}"`
        : `connection "${i.source.appLabel}"`,
    );
  }
  return envVars.flatMap((e) => {
    const shadowedSource = sourceLabelByName.get(e.name);
    return shadowedSource ? [{ envName: e.name, shadowedSource }] : [];
  });
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
  const warnings = shadowWarnings(envVars, inherited);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12px] text-muted-foreground">
        Variables added here are sent directly to the agent as plaintext. Use
        them only for non-sensitive stubs and config — never secrets, which
        belong in Connections. Changes apply to this agent; restart it to pick
        them up.
      </p>

      {inherited.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SectionLabel>Inherited</SectionLabel>
          </div>
          <div className="flex flex-col gap-1">
            {inherited.map((e, i) => (
              <InheritedEnvRow key={`${e.name}:${i}`} entry={e} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Custom</SectionLabel>
        {warnings.length > 0 && (
          <Callout
            tone="warning"
            size="sm"
            className="flex flex-col gap-1 text-[12px]"
          >
            <div className="flex items-center gap-2 text-warning">
              <WarningAlt size={12} />
              <span className="font-bold uppercase tracking-[0.05em] text-[10px]">
                Shadowing inherited values
              </span>
            </div>
            <ul className="list-disc pl-5 text-muted-foreground">
              {warnings.map((w) => (
                <li key={w.envName}>
                  <span className="font-mono">{w.envName}</span> shadows{" "}
                  {w.shadowedSource}'s contribution
                </li>
              ))}
            </ul>
          </Callout>
        )}
        <EnvVarsEditor
          value={envVars}
          onChange={setEnvVars}
          disabled={saving}
        />
      </div>
    </div>
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
    <div className="group flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px]">
      <span
        className={cn("shrink-0", isSystem && "text-muted-foreground")}
        title={isSystem ? "Platform-managed" : `From connection: ${sourceName}`}
      >
        {isSystem ? <Locked size={12} /> : <Key size={12} />}
      </span>
      <span className="font-mono font-semibold text-foreground truncate">
        {entry.name}
      </span>
      <span className="text-muted-foreground">=</span>
      <span
        className="font-mono text-muted-foreground truncate flex-1"
        title={entry.value}
      >
        {entry.value}
      </span>
      {!isSystem && (
        <span className="text-[12px] text-muted-foreground truncate max-w-[160px]">
          {sourceName}
        </span>
      )}
    </div>
  );
}
