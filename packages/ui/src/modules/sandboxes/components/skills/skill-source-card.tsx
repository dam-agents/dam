import type { Skill, SkillRef, SkillSource } from "api-server-api";

import { skillKey } from "../../hooks/use-skills-surface.js";
import { SkillRow } from "./skill-row.js";
import { SkillRowsSkeleton } from "./skills-skeleton.js";

/** Strip the scheme and trailing `.git` so a repo reads as `host/org/repo`. */
function repoLabel(source: SkillSource): string {
  const base = source.gitUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  return source.path ? `${base} · ${source.path}` : base;
}

/** Splits a scan/publish error into its message and an optional call-to-action
 *  URL, which the services encode as `\nplatform-cta:<url>` (not connected /
 *  access not granted / repo not allow-listed). */
function SourceError({ error }: { error: string }) {
  const cta = error.match(/platform-cta:(\S+)/)?.[1];
  const message = error.replace(/\nplatform-cta:\S+/, "").trim();
  return (
    <div className="flex items-center gap-2 border-t border-border bg-danger-light px-4 py-2 text-[13px] text-danger">
      <span className="flex-1">{message}</span>
      {cta && (
        <a
          href={cta}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-semibold underline hover:opacity-80"
        >
          Fix it →
        </a>
      )}
    </div>
  );
}

/**
 * A single Skill Source rendered as a card: header (name · `N of M on` · repo
 * URL) over its skill rows. Source-admin actions (03), sorting/collapse (02),
 * and drift (06) attach here in later slices — the header keeps a trailing slot
 * for the kebab so adding them doesn't reshape the tree.
 */
export function SkillSourceCard({
  source,
  skills,
  loading,
  error,
  installedRef,
  busyKey,
  disabled,
  onToggle,
}: {
  source: SkillSource;
  /** `undefined` until this source's scan resolves — distinct from an empty
   *  array (loaded, genuinely no skills), so we skeleton instead of flashing
   *  "No skills". */
  skills: Skill[] | undefined;
  loading: boolean;
  error: string | null;
  installedRef: (source: string, name: string) => SkillRef | undefined;
  busyKey: string | null;
  disabled: boolean;
  onToggle: (skill: Skill) => void;
}) {
  const busy = loading || skills === undefined;
  const list = skills ?? [];
  const installedCount = list.filter(
    (s) => installedRef(s.source, s.name) !== undefined,
  ).length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {source.name}
            </p>
            {!busy && !error && (
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {installedCount} of {list.length} on
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-muted-foreground">
            {repoLabel(source)}
          </p>
        </div>
      </div>

      {busy && !error && <SkillRowsSkeleton />}
      {!busy && error && <SourceError error={error} />}
      {!busy && !error && list.length === 0 && (
        <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
          No skills in this source.
        </p>
      )}
      {!busy &&
        !error &&
        list.map((skill) => (
          <SkillRow
            key={skillKey(skill.source, skill.name)}
            skill={skill}
            installed={installedRef(skill.source, skill.name) !== undefined}
            busy={busyKey === skillKey(skill.source, skill.name)}
            disabled={disabled}
            onToggle={() => onToggle(skill)}
          />
        ))}
    </div>
  );
}
