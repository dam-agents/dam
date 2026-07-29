import { Edit, TrashCan, Upload } from "@carbon/icons-react";
import { useRef, useState } from "react";

import { DialogBody, DialogFooter } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type {
  StagedSkill,
  UploadStaging,
} from "../../hooks/use-upload-staging.js";

/** Mirror of agent-runtime's `makeSkillSlug` so the UI can reject a name that
 *  would reduce to an empty skill id (e.g. emoji- or CJK-only) up front,
 *  instead of surfacing the pod's opaque BAD_REQUEST. */
function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "Upload .md files" tab: drop or pick Markdown files, review one staged row
 * per file (inline rename / remove), then create them all as standalone skills.
 * Non-`.md` and oversized files are rejected with an inline notice; a name
 * collision keeps the modal open and marks the offending rows.
 *
 * Presentational: the staging state lives in `useUploadStaging` (owned by the
 * modal shell) so it survives tab switches. Only view-local state (which row is
 * being renamed, the drop-zone highlight) lives here.
 */
export function UploadSkillsTab({
  staging,
  onClose,
}: {
  staging: UploadStaging;
  onClose: () => void;
}) {
  const { staged, notice, conflicts, topError, submitting, addFiles } = staging;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmedNames = staged.map((s) => s.name.trim());
  const hasEmpty = trimmedNames.some((n) => n.length === 0);
  // Compare slugs, not names: the pod keys skills by slug, so "My Skill" and
  // "my_skill" collide there. Left to the server it comes back as a CONFLICT
  // that marks both rows "already exists" — true of neither.
  const slugs = staged.map((s) => toSlug(s.name)).filter(Boolean);
  const hasDuplicate = new Set(slugs).size !== slugs.length;
  const hasUnsluggable = staged.some(
    (s) => s.name.trim().length > 0 && toSlug(s.name) === "",
  );
  const canSubmit =
    staged.length > 0 &&
    !hasEmpty &&
    !hasDuplicate &&
    !hasUnsluggable &&
    !submitting;

  const submitLabel = submitting
    ? "Adding…"
    : staged.length === 0
      ? "Add skills"
      : `Add ${staged.length} skill${staged.length === 1 ? "" : "s"}`;

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void addFiles([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted",
          )}
        >
          <Upload size={20} className="text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">
            Drop .md files here, or click to browse
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />

        {notice && <p className="text-[13px] text-destructive">{notice}</p>}
        {topError && <p className="text-[13px] text-destructive">{topError}</p>}
        {hasDuplicate && (
          <p className="text-[13px] text-destructive">
            Two staged skills resolve to the same skill id — rename one before
            adding.
          </p>
        )}

        {staged.length > 0 && (
          <div className="flex flex-col gap-2">
            {staged.map((skill) => (
              <StagedSkillRow
                key={skill.id}
                skill={skill}
                renaming={renamingId === skill.id}
                conflict={conflicts.has(skill.name.trim())}
                unsluggable={
                  skill.name.trim().length > 0 && toSlug(skill.name) === ""
                }
                onRename={(name) => staging.rename(skill.id, name)}
                onStartRename={() => setRenamingId(skill.id)}
                onEndRename={() => setRenamingId(null)}
                onRemove={() => staging.remove(skill.id)}
              />
            ))}
          </div>
        )}
      </DialogBody>

      <DialogFooter className="border-t border-border">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          className={cn(!canSubmit && "opacity-50")}
          disabled={!canSubmit}
          onClick={() => void staging.submit()}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

function StagedSkillRow({
  skill,
  renaming,
  conflict,
  unsluggable,
  onRename,
  onStartRename,
  onEndRename,
  onRemove,
}: {
  skill: StagedSkill;
  renaming: boolean;
  conflict: boolean;
  unsluggable: boolean;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onEndRename: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3",
        conflict || unsluggable ? "border-destructive" : "border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            size="sm"
            autoFocus
            value={skill.name}
            onChange={(e) => onRename(e.target.value)}
            onBlur={onEndRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEndRename();
            }}
          />
        ) : (
          <>
            <p className="truncate text-[15px] font-medium text-foreground">
              {skill.name || "Untitled skill"}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              {skill.fileName}
            </p>
          </>
        )}
        {conflict && (
          <p className="mt-1 text-[12px] text-destructive">
            A skill with this name already exists in this sandbox.
          </p>
        )}
        {!conflict && unsluggable && (
          <p className="mt-1 text-[12px] text-destructive">
            Name needs at least one letter or number.
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        title="Rename skill"
        onClick={onStartRename}
        className="shrink-0 text-muted-foreground"
      >
        <Edit size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        title="Remove skill"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground"
      >
        <TrashCan size={16} />
      </Button>
    </div>
  );
}
