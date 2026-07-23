import { useCallback, useEffect, useRef, useState } from "react";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_BYTES = 5 * 1024 * 1024;

export interface StagedSkill {
  id: string;
  fileName: string;
  name: string;
  content: string;
  bytes: number;
}

export interface CreateSkillsResult {
  ok: boolean;
  conflictNames?: string[];
  message?: string;
}

export interface UploadStaging {
  staged: StagedSkill[];
  notice: string | null;
  conflicts: Set<string>;
  topError: string | null;
  submitting: boolean;
  addFiles: (files: File[]) => Promise<void>;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  submit: () => Promise<void>;
}

/** Initial display name for an uploaded file: frontmatter `name:` when present
 *  (mirrors the shape parseFrontmatter matches — no block-scalar support
 *  needed for a name), else the prettified filename stem. */
function deriveName(fileName: string, content: string): string {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const nameLine = block?.[1].match(/^name:\s*(.+)$/m);
  if (nameLine) {
    const value = nameLine[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (value) return value;
  }
  return fileName
    .replace(/\.md$/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Upload-tab staging state for the add-skill-source modal. Lives here (called
 * from the modal shell) rather than inside the tab component so that switching
 * to the GitHub tab and back — which unmounts the tab — doesn't discard the
 * user's staged files, renames, and removals. The one-shot `initialFiles` seed
 * therefore runs once per modal open, not once per tab visit.
 */
export function useUploadStaging({
  initialFiles,
  onCreateSkills,
  onClose,
}: {
  initialFiles?: File[];
  onCreateSkills: (
    skills: { name: string; content: string }[],
  ) => Promise<CreateSkillsResult>;
  onClose: () => void;
}): UploadStaging {
  const [staged, setStaged] = useState<StagedSkill[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idRef = useRef(0);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const read = await Promise.all(
        files.map(async (file) => {
          const eligible =
            file.name.toLowerCase().endsWith(".md") &&
            file.size <= MAX_FILE_BYTES;
          return { file, content: eligible ? await file.text() : null };
        }),
      );
      const rejected: string[] = [];
      const additions: StagedSkill[] = [];
      let batch = staged.reduce((n, s) => n + s.bytes, 0);
      for (const { file, content } of read) {
        if (!file.name.toLowerCase().endsWith(".md")) {
          rejected.push(`${file.name} (not a .md file)`);
        } else if (file.size > MAX_FILE_BYTES) {
          rejected.push(`${file.name} (over 2 MB)`);
        } else if (batch + file.size > MAX_BATCH_BYTES) {
          rejected.push(`${file.name} (batch over 5 MB)`);
        } else {
          batch += file.size;
          additions.push({
            id: `f${idRef.current++}`,
            fileName: file.name,
            name: deriveName(file.name, content ?? ""),
            content: content ?? "",
            bytes: file.size,
          });
        }
      }
      if (additions.length > 0) setStaged((prev) => [...prev, ...additions]);
      setNotice(rejected.length ? `Skipped ${rejected.join(", ")}` : null);
    },
    [staged],
  );

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (initialFiles?.length) void addFiles(initialFiles);
  }, [initialFiles, addFiles]);

  const rename = useCallback((id: string, name: string) => {
    setStaged((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);
  const remove = useCallback((id: string) => {
    setStaged((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setTopError(null);
    const result = await onCreateSkills(
      staged.map((s) => ({ name: s.name.trim(), content: s.content })),
    );
    setSubmitting(false);
    if (result.ok) {
      onClose();
      return;
    }
    const names = result.conflictNames ?? [];
    if (names.length > 0) setConflicts(new Set(names));
    else setTopError(result.message ?? "Failed to add skills");
  }, [staged, onCreateSkills, onClose]);

  return {
    staged,
    notice,
    conflicts,
    topError,
    submitting,
    addFiles,
    rename,
    remove,
    submit,
  };
}
