import type { Skill, SkillSource } from "api-server-api";
import { skillKey, skillSetNameSchema } from "api-server-api";
import { useMemo, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { CheckboxItem } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { useToggleSet } from "@/hooks/use-toggle-set";

export interface SaveSetGroup {
  source: SkillSource;
  skills: Skill[];
}

/**
 * Save what's on in this sandbox as a named, reusable skill set.
 *
 * Opens pre-marked with everything currently installed, so the common case is
 * "type a name, Create" and unmarking is the edit path. Only source-backed
 * skills are offered: a set installs by name from a source, so a skill authored
 * here or shipped with the image has nowhere to install from.
 */
export function SaveSkillSetModal({
  groups,
  omitted,
  isOn,
  existingNames,
  onCreate,
  onClose,
}: {
  /** Source-backed skills, grouped by source — a set reads as "these skills,
   *  from these repos" rather than a flat bag of names. */
  groups: SaveSetGroup[];
  /** Connected sources whose scan failed while skills from them stay on, with
   *  how many. Those skills can't be offered below, and the dialog promises to
   *  start from what's on — so it names what it dropped instead of implying
   *  the list is complete. */
  omitted: { source: SkillSource; count: number }[];
  /** Whether a skill is currently installed. Read once, at mount, to seed the
   *  snapshot below. */
  isOn: (skill: Skill) => boolean;
  /** Existing set names, so a clash is caught before submitting. The server
   *  still answers CONFLICT — another session may take the name meanwhile. */
  existingNames: ReadonlySet<string>;
  onCreate: (input: {
    name: string;
    skills: { source: string; name: string }[];
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  // One snapshot — rows and marks together — for the dialog's whole lifetime.
  // Both inputs move underneath it: the 5s poll folds in agent-initiated
  // installs, and a re-scan re-lists a source. Reading either live would put an
  // "on here" badge beside an unchecked box under copy promising the marks start
  // from what's on, and the created set would omit the skill it named.
  const [snapshot] = useState(() => {
    const on = new Set<string>();
    for (const group of groups) {
      for (const skill of group.skills) {
        if (isOn(skill)) on.add(skillKey(skill));
      }
    }
    return { groups, on, omitted };
  });
  const {
    selected: marked,
    toggle,
    setAll,
    clear,
  } = useToggleSet<string>(() => snapshot.on);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const nameError = useMemo(() => {
    if (!trimmed) return null;
    const parsed = skillSetNameSchema.safeParse(trimmed);
    if (!parsed.success)
      return parsed.error.issues[0]?.message ?? "invalid name";
    if (existingNames.has(trimmed)) {
      return `A skill set named "${trimmed}" already exists.`;
    }
    return null;
  }, [trimmed, existingNames]);

  const allKeys = useMemo(
    () => snapshot.groups.flatMap((g) => g.skills.map((s) => skillKey(s))),
    [snapshot],
  );

  const omittedCount = snapshot.omitted.reduce((n, o) => n + o.count, 0);

  const canCreate = !!trimmed && !nameError && marked.size > 0 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    const skills = snapshot.groups.flatMap((g) =>
      g.skills
        .filter((s) => marked.has(skillKey(s)))
        .map((s) => ({ source: s.source, name: s.name })),
    );
    const ok = await onCreate({ name: trimmed, skills });
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal widthClass="w-[640px]">
      <DialogHeader title="Save as skill set" onClose={onClose} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) void submit();
        }}
      >
        <DialogBody className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Starts from what's on here — unmark anything you don't want in the
            set.
          </p>

          {omittedCount > 0 && (
            <p className="text-sm text-warning-fg">
              {omittedCount} skill{omittedCount === 1 ? "" : "s"} that{" "}
              {omittedCount === 1 ? "is" : "are"} on can't be included —{" "}
              {snapshot.omitted.map((o) => o.source.name).join(", ")} can't be
              read right now.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <SectionLabel>Set name</SectionLabel>
            <Input
              size="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-skill-set"
              variant={nameError ? "invalid" : "standard"}
              aria-label="Set name"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "set-name-error" : undefined}
              autoFocus
            />
            {nameError && (
              <p id="set-name-error" className="text-sm text-danger">
                {nameError}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {marked.size} skill{marked.size === 1 ? "" : "s"} selected
            </span>
            <span className="flex-1" />
            <Button
              type="button"
              variant="link"
              size="inline"
              onClick={() => setAll(allKeys)}
            >
              Select all
            </Button>
            <span aria-hidden>·</span>
            <Button type="button" variant="link" size="inline" onClick={clear}>
              Clear
            </Button>
          </div>

          <div className="flex max-h-[40vh] flex-col gap-4 overflow-y-auto">
            {snapshot.groups.map((group) => (
              <div key={group.source.id} className="flex flex-col gap-2">
                <SectionLabel>{group.source.name}</SectionLabel>
                {group.skills.map((skill) => {
                  const key = skillKey(skill);
                  return (
                    <div key={key} className="flex items-start gap-2">
                      <CheckboxItem
                        label={skill.name}
                        description={skill.description}
                        checked={marked.has(key)}
                        onCheckedChange={() => toggle(key)}
                      />
                      {snapshot.on.has(key) && (
                        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                          on here
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">
            Only skills from a connected source can go in a set — a set installs
            by name, and skills authored here or shipped with the image have
            nowhere to install from.
          </p>
        </DialogBody>

        <DialogActions
          className="border-t border-border"
          onCancel={onClose}
          label="Create"
          pendingLabel="Creating…"
          pending={submitting}
          disabled={!canCreate}
        />
      </form>
    </Modal>
  );
}
