import { ChevronLeft, Close, Download, Edit, Save } from "@carbon/icons-react";
import { useCallback, useEffect, useState } from "react";

import { RenderToggle } from "@/components/render-toggle";
import { Button } from "@/components/ui/button";

import { TruncateStart } from "../../../components/truncate-start.js";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useFilePromotion } from "../../artifacts/hooks/use-file-promotion.js";
import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import { type FileContent, useFileWriteMutation } from "../api/queries.js";
import { base64ToBlob, downloadFileContent } from "../lib/download.js";
import { PLATFORM_INSTRUCTIONS_PATH } from "../lib/platform-instructions.js";
import { saveFileDraft } from "../lib/save-file.js";
import { FilePreviewBody } from "./file-preview-body.js";

interface Props {
  file: FileContent;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

const TOOLBAR_LABEL = "hidden @xl/file-toolbar:inline";

export function FileViewer({ file, onClose, onOpenFile }: Props) {
  const { path, content, binary, mimeType: mime, tooLarge } = file;
  const isMarkdown = mime === "text/markdown";
  const isSvg = mime === "image/svg+xml";
  const isHtml = mime === "text/html";
  const isPdf = mime === "application/pdf";
  const platformInstructions = path === PLATFORM_INSTRUCTIONS_PATH;
  const editable = !binary && !tooLarge && !platformInstructions;

  const selectedAgent = useStore((s) => s.selectedAgent);
  const promotion = useFilePromotion(selectedAgent, file);
  const setOpenFileDirty = useStore((s) => s.setOpenFileDirty);
  const showConfirm = useStore((s) => s.showConfirm);
  const openFileEdit = useStore((s) => s.openFileEdit);
  const setOpenFileEdit = useStore((s) => s.setOpenFileEdit);

  const [renderMd, setRenderMd] = useState(true);
  const [renderSvg, setRenderSvg] = useState(true);
  const [renderHtml, setRenderHtml] = useState(true);
  const [editMode, setEditMode] = useState(editable && openFileEdit);
  const [draft, setDraft] = useState(content);
  const [baseMtimeMs, setBaseMtimeMs] = useState<number | undefined>(
    file.mtimeMs,
  );

  useEffect(() => {
    if (openFileEdit) {
      if (editable) setEditMode(true);
      setOpenFileEdit(false);
    }
  }, [openFileEdit, editable, setOpenFileEdit]);

  const dirty = editMode && draft !== content;
  const changedOnDisk =
    editMode &&
    file.mtimeMs != null &&
    baseMtimeMs != null &&
    file.mtimeMs !== baseMtimeMs;
  useUnsavedGuard(dirty);
  useEffect(() => {
    setOpenFileDirty(dirty);
    return () => setOpenFileDirty(false);
  }, [dirty, setOpenFileDirty]);

  useEffect(() => {
    if (!editMode) {
      setDraft(content);
      setBaseMtimeMs(file.mtimeMs);
    }
  }, [content, file.mtimeMs, editMode, path]);

  const writeMutation = useFileWriteMutation(selectedAgent);

  const save = useCallback(async () => {
    if (!selectedAgent || !editable) return;
    const outcome = await saveFileDraft(draft, baseMtimeMs, {
      write: (input) => writeMutation.mutateAsync({ path, ...input }),
      confirmOverwrite: () =>
        showConfirm(
          "This file changed on disk since you opened it. Saving replaces that version with yours.",
          "Overwrite the newer version?",
        ),
    });
    if (outcome.kind === "saved") {
      setBaseMtimeMs(outcome.mtimeMs);
      setEditMode(false);
      emitToast({ kind: "success", message: `Saved ${path}` });
    } else if (outcome.kind === "failed") {
      emitToast({ kind: "error", message: outcome.message });
    }
  }, [
    selectedAgent,
    editable,
    writeMutation,
    path,
    draft,
    baseMtimeMs,
    showConfirm,
  ]);

  const cancelEdit = async () => {
    if (dirty) {
      const ok = await showConfirm(
        "Your edits are lost.",
        "Discard unsaved changes?",
        {
          kind: "destructive",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
        },
      );
      if (!ok) return;
    }
    setDraft(content);
    setEditMode(false);
  };

  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !content) {
      setPdfBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(base64ToBlob(content, "application/pdf"));
    setPdfBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [content, isPdf]);

  const promotionLabel = promotion.pending
    ? "Publishing…"
    : promotion.linked
      ? "Sync to artifact"
      : "Create artifact";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="@container/file-toolbar flex items-center gap-2 pl-2 pr-4 h-12 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onClose}
          aria-label="Back to files"
          tooltip="Back to files"
        >
          <ChevronLeft size={16} />
        </Button>
        <TruncateStart
          className="text-sm font-medium text-foreground flex-1 min-w-0"
          title={path}
        >
          {dirty ? `● ${path}` : path}
        </TruncateStart>
        {editMode ? (
          <>
            {changedOnDisk && (
              <span
                role="status"
                className="text-xs text-warning shrink-0"
                title="Another process changed this file after you started editing. Saving asks before it overwrites."
              >
                Changed on disk
              </span>
            )}
            <Button
              variant="ghost"
              size="xs"
              className="text-sm font-normal"
              onClick={cancelEdit}
            >
              <Close size={14} /> Cancel
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-sm font-normal"
              onClick={save}
              disabled={!dirty || writeMutation.isPending}
              tooltip="Save (Cmd/Ctrl+S)"
            >
              <Save size={14} /> {writeMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="xs"
              className="text-sm font-normal"
              aria-label={promotionLabel}
              disabled={!promotion.promotable || promotion.pending}
              tooltip={
                promotion.promotable || !promotion.linkReady
                  ? promotionLabel
                  : "Binary and oversized files can't be promoted from the panel"
              }
              onClick={() => void promotion.promote()}
            >
              <ArtifactIcon size={14} />
              <span className={TOOLBAR_LABEL}>{promotionLabel}</span>
            </Button>
            {editable && (
              <Button
                variant="ghost"
                size="xs"
                className="text-sm font-normal"
                onClick={() => setEditMode(true)}
                aria-label="Edit"
                tooltip="Edit"
              >
                <Edit size={14} /> <span className={TOOLBAR_LABEL}>Edit</span>
              </Button>
            )}
            {!tooLarge && (
              <Button
                variant="ghost"
                size="xs"
                className="text-sm font-normal"
                onClick={() => downloadFileContent(file)}
                aria-label="Download"
                tooltip="Download"
              >
                <Download size={14} />{" "}
                <span className={TOOLBAR_LABEL}>Download</span>
              </Button>
            )}
            {isSvg && (
              <RenderToggle
                rendered={renderSvg}
                onToggle={() => setRenderSvg((p) => !p)}
                variant="ghost"
                className="text-sm"
                labelClassName={TOOLBAR_LABEL}
              />
            )}
            {isMarkdown && (
              <RenderToggle
                rendered={renderMd}
                onToggle={() => setRenderMd((p) => !p)}
                variant="ghost"
                className="text-sm"
                labelClassName={TOOLBAR_LABEL}
              />
            )}
            {isHtml && (
              <RenderToggle
                rendered={renderHtml}
                onToggle={() => setRenderHtml((p) => !p)}
                variant="ghost"
                className="text-sm"
                labelClassName={TOOLBAR_LABEL}
              />
            )}
          </>
        )}
      </div>
      {platformInstructions && (
        <p className="px-4 py-2 border-b border-border text-xs text-muted-foreground">
          This file holds the platform's instructions and is read-only. Put your
          own instructions in <code>work/AGENTS.md</code>.
        </p>
      )}
      <div
        className={
          editMode ? "flex-1 overflow-hidden p-2" : "flex-1 overflow-auto p-4"
        }
      >
        <FilePreviewBody
          file={file}
          editMode={editMode}
          draft={draft}
          onDraftChange={setDraft}
          onSave={save}
          renderSvg={renderSvg}
          renderMd={renderMd}
          renderHtml={renderHtml}
          pdfBlobUrl={pdfBlobUrl}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}
