import {
  ArrowLeft,
  Close as X,
  Download,
  Edit as Pencil,
  Maximize,
  Save,
} from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import {
  fetchFileContent,
  type FileContent,
  useFileWriteMutation,
} from "../api/queries.js";
import { base64ToBlob, downloadFileContent } from "../lib/download.js";
import { FilePreviewBody } from "./file-preview-body.js";
import { FullscreenPreviewDialog } from "./fullscreen-preview-dialog.js";
import { RenderToggle } from "./render-toggle.js";

interface Props {
  file: FileContent;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

export function FileViewer({ file, onClose, onOpenFile }: Props) {
  const { path, content, binary, mimeType: mime, tooLarge } = file;
  const isMarkdown = mime === "text/markdown";
  const isSvg = mime === "image/svg+xml";
  const isHtml = mime === "text/html";
  const isPdf = mime === "application/pdf";
  const isBinaryImage =
    binary && !!content && !!mime && mime.startsWith("image/") && !isSvg;
  const editable = !binary && !tooLarge;

  const selectedAgent = useStore((s) => s.selectedAgent);
  const setOpenFileDirty = useStore((s) => s.setOpenFileDirty);
  const showConfirm = useStore((s) => s.showConfirm);
  const openFileEdit = useStore((s) => s.openFileEdit);
  const setOpenFileEdit = useStore((s) => s.setOpenFileEdit);

  const [renderMd, setRenderMd] = useState(true);
  const [renderSvg, setRenderSvg] = useState(true);
  const [renderHtml, setRenderHtml] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [editMode, setEditMode] = useState(editable && openFileEdit);
  const [draft, setDraft] = useState(content);
  const [baseMtimeMs, setBaseMtimeMs] = useState<number | undefined>(
    file.mtimeMs,
  );

  // If the user opens already opened file for editiing
  useEffect(() => {
    if (openFileEdit) {
      if (editable) setEditMode(true);
      setOpenFileEdit(false);
    }
  }, [openFileEdit, editable, setOpenFileEdit]);

  // Leaving fullscreen when the viewer switches to a different file.
  useEffect(() => setIsExpanded(false), [path]);

  const dirty = editMode && draft !== content;
  useUnsavedGuard(dirty);
  useEffect(() => {
    setOpenFileDirty(dirty);
    return () => setOpenFileDirty(false);
  }, [dirty, setOpenFileDirty]);

  // Reset draft / baseline when the user switches files or the cache delivers
  // fresh content (e.g., after a save or external change).
  useEffect(() => {
    if (!editMode) {
      setDraft(content);
      setBaseMtimeMs(file.mtimeMs);
    }
  }, [content, file.mtimeMs, editMode, path]);

  const writeMutation = useFileWriteMutation(selectedAgent);

  const save = useCallback(async () => {
    if (!selectedAgent || !editable) return;
    try {
      const res = await writeMutation.mutateAsync({
        path,
        content: draft,
        expectedMtimeMs: baseMtimeMs,
      });
      setBaseMtimeMs(res.mtimeMs);
      setEditMode(false);
      emitToast({ kind: "success", message: `Saved ${path}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (/conflict|changed on disk/i.test(msg)) {
        const ok = await showConfirm(
          "This file changed on disk since you opened it. Overwrite with your changes?",
          "File changed on disk",
        );
        if (!ok) {
          // Refresh from disk and leave draft intact so the user can merge.
          const fresh = await fetchFileContent(selectedAgent, path);
          setBaseMtimeMs(fresh.mtimeMs);
          return;
        }
        try {
          const res = await writeMutation.mutateAsync({ path, content: draft });
          setBaseMtimeMs(res.mtimeMs);
          setEditMode(false);
          emitToast({ kind: "success", message: `Saved ${path}` });
        } catch (err2) {
          emitToast({
            kind: "error",
            message: err2 instanceof Error ? err2.message : "Save failed",
          });
        }
        return;
      }
      emitToast({ kind: "error", message: msg });
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

  const cancelEdit = useCallback(async () => {
    if (dirty) {
      const ok = await showConfirm(
        "Discard unsaved changes?",
        "Unsaved changes",
      );
      if (!ok) return;
    }
    setDraft(content);
    setEditMode(false);
  }, [dirty, content, showConfirm]);

  // Create blob URL for PDF rendering; revoke on change/unmount to avoid leaking
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

  const downloadFile = useCallback(() => downloadFileContent(file), [file]);

  const pathLabel = useMemo(() => (dirty ? `● ${path}` : path), [dirty, path]);

  // Whether the current view is a rendered preview (not source/editor/hex) and
  // therefore worth offering at full size.
  const isRenderedPreview =
    !editMode &&
    (isBinaryImage ||
      (isPdf && !!pdfBlobUrl) ||
      (isSvg && renderSvg) ||
      (isMarkdown && renderMd) ||
      (isHtml && renderHtml));

  const previewBody = (
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
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:text-primary shrink-0"
          onClick={onClose}
        >
          <ArrowLeft size={12} /> Back
        </Button>
        <span
          className="text-[12px] font-mono text-foreground/80 truncate flex-1"
          title={path}
        >
          {pathLabel}
        </span>
        {editable && !editMode && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-primary"
            onClick={() => setEditMode(true)}
            title="Edit file"
          >
            <Pencil size={11} /> Edit
          </Button>
        )}
        {editMode && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground/80"
              onClick={cancelEdit}
              title="Cancel"
            >
              <X size={11} /> Cancel
            </Button>
            <Button
              size="sm"
              className="h-auto px-2 py-0.5 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 hover:text-primary"
              variant="ghost"
              onClick={save}
              disabled={!dirty || writeMutation.isPending}
              title="Save (Cmd/Ctrl+S)"
            >
              <Save size={11} /> {writeMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )}
        {isRenderedPreview && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-primary"
            onClick={() => setIsExpanded(true)}
            title="Open fullscreen"
          >
            <Maximize size={11} /> Fullscreen
          </Button>
        )}
        {!tooLarge && !editMode && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-primary"
            onClick={downloadFile}
            title="Download file"
          >
            <Download size={11} />
          </Button>
        )}
        {isSvg && !editMode && (
          <RenderToggle
            rendered={renderSvg}
            onToggle={() => setRenderSvg((p) => !p)}
            rawTitle="Show raw SVG"
            renderTitle="Render SVG"
          />
        )}
        {isMarkdown && !editMode && (
          <RenderToggle
            rendered={renderMd}
            onToggle={() => setRenderMd((p) => !p)}
            rawTitle="Show raw"
            renderTitle="Render markdown"
          />
        )}
        {isHtml && !editMode && (
          <RenderToggle
            rendered={renderHtml}
            onToggle={() => setRenderHtml((p) => !p)}
            rawTitle="Show raw HTML"
            renderTitle="Render HTML"
          />
        )}
      </div>
      <div
        className={
          editMode ? "flex-1 overflow-hidden p-2" : "flex-1 overflow-auto p-4"
        }
      >
        {isExpanded ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            Opened in fullscreen
          </div>
        ) : (
          previewBody
        )}
      </div>
      {isExpanded && (
        <FullscreenPreviewDialog
          title={path}
          onClose={() => setIsExpanded(false)}
        >
          {previewBody}
        </FullscreenPreviewDialog>
      )}
    </div>
  );
}
