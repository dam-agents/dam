import type { SkillSet } from "api-server-api";
import { useMemo, useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { skillKey } from "../../hooks/use-skills-surface.js";

/** What one set would do to this sandbox right now. Derived in the browser from
 *  lists the surface already holds, so ticking a box is instant; the server
 *  recomputes the same thing and stays authoritative. */
interface SetPreview {
  set: SkillSet;
  /** Skill names this set would turn on that aren't on already. */
  adds: string[];
  /** Entries whose source this sandbox has no connection to at all. */
  unavailable: number;
  /** Entries whose source *is* connected but failed to scan — a credential or
   *  transport problem, not a missing source. Told apart from `unavailable`
   *  because the fix is different: one needs the source added, the other needs
   *  the source to become readable. */
  unreadable: number;
}

function SetRow({
  preview,
  ready,
  checked,
  onToggle,
}: {
  preview: SetPreview;
  /** Every source has reported. Until then there is no honest verdict: an
   *  unscanned source is indistinguishable from an unconnected one, and saying
   *  "not in a connected source" about a perfectly good set is worse than
   *  saying nothing. */
  ready: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const { set, adds, unavailable, unreadable } = preview;
  const sample = set.skills.slice(0, 3).map((s) => s.name);
  const rest = set.skills.length - sample.length;
  // 0 adds means "already on" only when everything is actually available;
  // otherwise the unavailable clause is the whole story.
  const blocked = unavailable + unreadable;
  const verdict = !ready
    ? null
    : adds.length > 0
      ? `adds ${adds.length}`
      : blocked < set.skills.length
        ? "already all on"
        : null;
  return (
    <label className="flex w-full cursor-pointer items-start gap-2.5 text-left">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={set.name}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{set.name}</span>
        <span className="text-sm text-muted-foreground">
          {set.skills.length} skill{set.skills.length === 1 ? "" : "s"} ·{" "}
          {sample.join(", ")}
          {rest > 0 && `, +${rest}`}
          {verdict && ` · ${verdict}`}
          {ready && unavailable > 0 && (
            <span className="text-amber-700 dark:text-warning">
              {" "}
              · {unavailable} not in a connected source
            </span>
          )}
          {ready && unreadable > 0 && (
            <span className="text-amber-700 dark:text-warning">
              {" "}
              · {unreadable} from a source that can't be read here
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

/**
 * Add one or more saved skill sets to this sandbox.
 *
 * Multi-select rather than single: adding is additive, so picking two sets is
 * just the union of their skills. Each row says what it would *add* on top of
 * what's already on, because picking shouldn't be a guess, and the footer counts
 * the union — two sets sharing a skill add it once.
 */
export function AddSkillSetsModal({
  sets,
  loadFailed,
  available,
  installedKeys,
  unreadableSources,
  ready,
  applying,
  onApply,
  onClose,
}: {
  sets: SkillSet[];
  /** The sets request failed, so `sets` being empty says nothing about whether
   *  the user has any. Worded apart from the empty state for that reason. */
  loadFailed: boolean;
  /** `skillKey` for every skill a connected source can serve here. */
  available: ReadonlySet<string>;
  /** `skillKey` for every skill currently installed. */
  installedKeys: ReadonlySet<string>;
  /** Git URLs of connected sources whose scan failed here. */
  unreadableSources: ReadonlySet<string>;
  /** Every connected source has reported its skills, so the per-set verdicts
   *  can be trusted. */
  ready: boolean;
  applying: boolean;
  /** Returns false when nothing could be applied, so the modal stays open. */
  onApply: (setIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const previews = useMemo<SetPreview[]>(
    () =>
      sets.map((set) => {
        const adds: string[] = [];
        let unavailable = 0;
        let unreadable = 0;
        for (const entry of set.skills) {
          const key = skillKey(entry.source, entry.name);
          if (available.has(key)) {
            if (!installedKeys.has(key)) adds.push(entry.name);
          } else if (unreadableSources.has(entry.source)) {
            unreadable += 1;
          } else {
            unavailable += 1;
          }
        }
        return { set, adds, unavailable, unreadable };
      }),
    [sets, available, installedKeys, unreadableSources],
  );

  // The union, not the sum: two picked sets sharing a skill add it once.
  const unionAdds = useMemo(() => {
    const names = new Set<string>();
    for (const p of previews) {
      if (picked.has(p.set.id)) for (const n of p.adds) names.add(n);
    }
    return names.size;
  }, [previews, picked]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (await onApply([...picked])) onClose();
  };

  return (
    <Modal>
      <DialogHeader title="Add skill sets" onClose={onClose} />

      <DialogBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Pick any number. Their skills turn on alongside what you already have
          — overlap is fine, and nothing gets turned off.
        </p>

        {loadFailed ? (
          <p className="text-sm text-danger">
            Couldn't load your saved skill sets. Reopen the Skills page to try
            again.
          </p>
        ) : sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved skill sets yet — save one from this sandbox first.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {previews.map((preview) => (
              <SetRow
                key={preview.set.id}
                preview={preview}
                ready={ready}
                checked={picked.has(preview.set.id)}
                onToggle={() => toggle(preview.set.id)}
              />
            ))}
          </div>
        )}
      </DialogBody>

      <DialogFooter className="border-t border-border">
        <span className="flex-1 text-sm text-muted-foreground">
          {picked.size === 0
            ? "No sets selected"
            : !ready
              ? `${picked.size} set${picked.size === 1 ? "" : "s"} selected`
              : `${picked.size} set${picked.size === 1 ? "" : "s"} · turns on ${unionAdds} new skill${unionAdds === 1 ? "" : "s"}`}
        </span>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={picked.size === 0 || applying}
          onClick={() => void submit()}
        >
          {applying ? "Adding…" : "Add skills"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
