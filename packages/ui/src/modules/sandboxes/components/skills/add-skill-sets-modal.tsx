import { TrashCan } from "@carbon/icons-react";
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
import { useToggleSet } from "@/hooks/use-toggle-set";

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
  deleting,
  onToggle,
  onDelete,
}: {
  preview: SetPreview;
  /** Every source has reported. Until then there is no honest verdict: an
   *  unscanned source is indistinguishable from an unconnected one, and saying
   *  "not in a connected source" about a perfectly good set is worse than
   *  saying nothing. */
  ready: boolean;
  checked: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { set, adds, unavailable, unreadable } = preview;
  // Confirmed in the row, not through the global confirm dialog: this row lives
  // inside a modal, and a second layered dialog would fight this one's focus
  // trap. Two clicks still stand between a saved set and losing it.
  const [confirming, setConfirming] = useState(false);
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
    <div className="flex w-full items-start gap-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={set.name}
          className="mt-0.5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {set.name}
          </span>
          <span className="text-sm text-muted-foreground">
            {set.skills.length} skill{set.skills.length === 1 ? "" : "s"} ·{" "}
            {sample.join(", ")}
            {rest > 0 && `, +${rest}`}
            {verdict && ` · ${verdict}`}
            {ready && unavailable > 0 && (
              <span className="text-warning-fg">
                {" "}
                · {unavailable} not in a connected source
              </span>
            )}
            {ready && unreadable > 0 && (
              <span className="text-warning-fg">
                {" "}
                · {unreadable} from a source that can't be read here
              </span>
            )}
          </span>
        </span>
      </label>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground">Delete this set?</span>
          <Button
            variant="link"
            size="inline"
            className="text-danger"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
          <Button
            variant="link"
            size="inline"
            disabled={deleting}
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${set.name}`}
          tooltip="Delete set"
          className="shrink-0 text-muted-foreground"
          onClick={() => setConfirming(true)}
        >
          <TrashCan size={16} />
        </Button>
      )}
    </div>
  );
}

/**
 * Add one or more saved skill sets to this sandbox.
 *
 * Multi-select rather than single: adding is additive, so picking two sets is
 * just the union of their skills. Each row says what it would *add* on top of
 * what's already on, because picking shouldn't be a guess, and the footer counts
 * the union — two sets sharing a skill add it once.
 *
 * Deleting lives here too: sets have no rename, so correcting a typo means
 * deleting one, and this is the only surface that lists them.
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
  onDelete,
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
  /** Delete a set for good. Returns whether it went. */
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { selected: picked, toggle } = useToggleSet<string>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const submit = async () => {
    if (await onApply([...picked])) onClose();
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    const gone = await onDelete(id);
    setDeletingId(null);
    // A deleted set must leave the selection with it, or Add would send an id
    // the server no longer has and the whole apply would fail.
    if (gone && picked.has(id)) toggle(id);
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
                deleting={deletingId === preview.set.id}
                onToggle={() => toggle(preview.set.id)}
                onDelete={() => void remove(preview.set.id)}
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
