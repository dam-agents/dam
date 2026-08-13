import { TrashCan } from "@carbon/icons-react";
import type { SkillSet } from "api-server-api";
import { skillKey } from "api-server-api";
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

interface SetPreview {
  set: SkillSet;
  adds: string[];
  unavailable: number;
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
  ready: boolean;
  checked: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { set, adds, unavailable, unreadable } = preview;
  const [confirming, setConfirming] = useState(false);
  const sample = set.skills.slice(0, 3).map((s) => s.name);
  const rest = set.skills.length - sample.length;
  const blocked = unavailable + unreadable;
  const verdict = !ready
    ? null
    : adds.length > 0
      ? `adds ${adds.length}`
      : blocked === 0
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
  loadFailed: boolean;
  available: ReadonlySet<string>;
  installedKeys: ReadonlySet<string>;
  unreadableSources: ReadonlySet<string>;
  ready: boolean;
  applying: boolean;
  onApply: (setIds: string[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { selected: picked, toggle, remove } = useToggleSet<string>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const previews = useMemo<SetPreview[]>(
    () =>
      sets.map((set) => {
        const adds: string[] = [];
        let unavailable = 0;
        let unreadable = 0;
        for (const entry of set.skills) {
          const key = skillKey(entry);
          if (available.has(key)) {
            if (!installedKeys.has(key)) adds.push(key);
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

  const unionAdds = useMemo(() => {
    const keys = new Set<string>();
    for (const p of previews) {
      if (picked.has(p.set.id)) for (const k of p.adds) keys.add(k);
    }
    return keys.size;
  }, [previews, picked]);

  const submit = async () => {
    if (await onApply([...picked])) onClose();
  };

  const removeSet = async (id: string) => {
    setDeletingId(id);
    const gone = await onDelete(id);
    setDeletingId(null);
    if (gone) remove(id);
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
                onDelete={() => void removeSet(preview.set.id)}
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
