import { TRPCClientError } from "@trpc/client";
import type { ArtifactContent, LibraryArtifact } from "api-server-api";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard.js";
import { getErrorMessage } from "../../../lib/errors.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useSaveArtifactContent } from "../api/mutations.js";
import { isEditableContent } from "../lib/editable.js";

interface Options {
  artifact: LibraryArtifact | null | undefined;
  content: ArtifactContent | null | undefined;
  isHeadVersion: boolean;
  initialEdit?: boolean;
  onEditConsumed?: () => void;
}

function isConflict(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.code === "CONFLICT";
}

export function useArtifactEditor({
  artifact,
  content,
  isHeadVersion,
  initialEdit,
  onEditConsumed,
}: Options) {
  const showConfirm = useStore((s) => s.showConfirm);
  const save = useSaveArtifactContent();

  const contentFits = useMemo(() => isEditableContent(content), [content]);
  const editable = !!artifact && contentFits && isHeadVersion;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content?.content ?? "");
  const [baseVersion, setBaseVersion] = useState(artifact?.version);

  useEffect(() => {
    if (editing) return;
    setDraft(content?.content ?? "");
    setBaseVersion(artifact?.version);
  }, [content?.content, artifact?.version, editing]);

  const [editIntent, setEditIntent] = useState(!!initialEdit);
  useEffect(() => {
    if (initialEdit) setEditIntent(true);
  }, [initialEdit]);

  useEffect(() => {
    if (!editIntent || !content) return;
    setEditIntent(false);
    if (editable) setEditing(true);
    onEditConsumed?.();
  }, [editIntent, content, editable, onEditConsumed]);

  const dirty = editing && content != null && draft !== content.content;
  useUnsavedGuard(dirty);

  const runSave = useCallback(
    async (claim?: { expectedVersion: number }) => {
      if (!artifact) throw new Error("The artifact is no longer available.");
      await save.mutateAsync({
        id: artifact.id,
        content: draft,
        ...claim,
      });
      setEditing(false);
      emitToast({ kind: "success", message: `Saved ${artifact.title}` });
    },
    [save, artifact, draft],
  );

  const commit = useCallback(async () => {
    if (baseVersion == null) {
      emitToast({
        kind: "error",
        message: "Can't tell which version you edited. Reload and try again.",
      });
      return;
    }
    try {
      await runSave({ expectedVersion: baseVersion });
    } catch (err) {
      if (!isConflict(err)) {
        emitToast({
          kind: "error",
          message: getErrorMessage(err, "Save failed"),
        });
        return;
      }
      const overwrite = await showConfirm(
        "This artifact has a newer version. Overwrite it with your changes?",
        "Artifact changed",
      );
      if (!overwrite) return;
      try {
        await runSave();
      } catch (retryErr) {
        emitToast({
          kind: "error",
          message: getErrorMessage(retryErr, "Save failed"),
        });
      }
    }
  }, [runSave, baseVersion, showConfirm]);

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return showConfirm("Discard unsaved changes?", "Unsaved changes");
  }, [dirty, showConfirm]);

  const cancelEdit = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setDraft(content?.content ?? "");
    setEditing(false);
  }, [confirmDiscard, content?.content]);

  return {
    editable,
    editing,
    draft,
    dirty,
    saving: save.isPending,
    setDraft,
    startEdit: useCallback(() => setEditing(true), []),
    cancelEdit,
    confirmDiscard,
    save: commit,
  };
}
