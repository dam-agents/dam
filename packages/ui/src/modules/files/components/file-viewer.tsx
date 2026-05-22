import { ArrowLeft, Code, Download, Eye, Pencil, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HighlightedCode } from "../../../components/highlighted-code.js";
import { Markdown } from "../../../components/markdown.js";
import { useStore } from "../../../store.js";
import {
  fetchFileContent,
  type FileContent,
  useFileWriteMutation,
} from "../api/queries.js";
import { useUnsavedGuard } from "../hooks/use-unsaved-guard.js";
import { CodeEditor } from "./code-editor.js";

interface Props {
  file: FileContent;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}

function hexDump(base64: string): string {
  const raw = atob(base64);
  const lines: string[] = [];
  const maxBytes = Math.min(raw.length, 1024);
  for (let off = 0; off < maxBytes; off += 16) {
    const slice = raw.slice(off, Math.min(off + 16, maxBytes));
    const hex = Array.from(slice)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(slice)
      .map((c) => {
        const code = c.charCodeAt(0);
        return code >= 0x20 && code < 0x7f ? c : ".";
      })
      .join("");
    lines.push(
      `${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`,
    );
  }
  if (raw.length > maxBytes)
    lines.push(`... ${raw.length - maxBytes} more bytes`);
  return lines.join("\n");
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function isImageMime(mime: string | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

export function FileViewer({ file, onClose, onOpenFile }: Props) {
  const { path, content, binary, mimeType: mime, tooLarge } = file;
  const isMarkdown = mime === "text/markdown";
  const isSvg = mime === "image/svg+xml";
  const isBinaryImage = binary && content && isImageMime(mime) && !isSvg;
  const isPdf = mime === "application/pdf";
  const hasContent = !!content;
  const filename = path.split("/").pop();
  const editable = !binary && hasContent;

  const selectedAgent = useStore((s) => s.selectedAgent);
  const setOpenFileDirty = useStore((s) => s.setOpenFileDirty);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const [renderMd, setRenderMd] = useState(true);
  const [renderSvg, setRenderSvg] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(content);
  const [baseMtimeMs, setBaseMtimeMs] = useState<number | undefined>(
    file.mtimeMs,
  );

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
      showToast({ kind: "success", message: `Saved ${path}` });
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
          showToast({ kind: "success", message: `Saved ${path}` });
        } catch (err2) {
          showToast({
            kind: "error",
            message: err2 instanceof Error ? err2.message : "Save failed",
          });
        }
        return;
      }
      showToast({ kind: "error", message: msg });
    }
  }, [
    selectedAgent,
    editable,
    writeMutation,
    path,
    draft,
    baseMtimeMs,
    showToast,
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

  const downloadFile = useCallback(() => {
    if (!content) return;
    const downloadName = path.split("/").pop() ?? "download";
    const blob = binary
      ? base64ToBlob(content, mime ?? "application/octet-stream")
      : new Blob([content], { type: mime ?? "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [path, content, binary, mime]);

  const pathLabel = useMemo(() => (dirty ? `● ${path}` : path), [dirty, path]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-light shrink-0">
        <button
          className="flex items-center gap-1 text-[12px] font-semibold text-text-muted hover:text-accent transition-colors shrink-0"
          onClick={onClose}
        >
          <ArrowLeft size={12} /> Back
        </button>
        <span
          className="text-[12px] font-mono text-text-secondary truncate flex-1"
          title={path}
        >
          {pathLabel}
        </span>
        {editable && !editMode && (
          <button
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md text-text-muted hover:text-accent transition-colors"
            onClick={() => setEditMode(true)}
            title="Edit file"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
        {editMode && (
          <>
            <button
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md text-text-muted hover:text-text-secondary transition-colors"
              onClick={cancelEdit}
              title="Cancel"
            >
              <X size={11} /> Cancel
            </button>
            <button
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md text-accent bg-accent-light hover:opacity-90 transition-opacity disabled:opacity-50"
              onClick={save}
              disabled={!dirty || writeMutation.isPending}
              title="Save (Cmd/Ctrl+S)"
            >
              <Save size={11} /> {writeMutation.isPending ? "Saving…" : "Save"}
            </button>
          </>
        )}
        {hasContent && !editMode && (
          <button
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md text-text-muted hover:text-accent transition-colors"
            onClick={downloadFile}
            title="Download file"
          >
            <Download size={11} />
          </button>
        )}
        {isSvg && !editMode && (
          <button
            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${renderSvg ? "text-accent bg-accent-light" : "text-text-muted hover:text-text-secondary"}`}
            onClick={() => setRenderSvg((p) => !p)}
            title={renderSvg ? "Show raw SVG" : "Render SVG"}
          >
            {renderSvg ? <Code size={11} /> : <Eye size={11} />}
            {renderSvg ? "Raw" : "Render"}
          </button>
        )}
        {isMarkdown && !editMode && (
          <button
            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${renderMd ? "text-accent bg-accent-light" : "text-text-muted hover:text-text-secondary"}`}
            onClick={() => setRenderMd((p) => !p)}
            title={renderMd ? "Show raw" : "Render markdown"}
          >
            {renderMd ? <Code size={11} /> : <Eye size={11} />}
            {renderMd ? "Raw" : "Render"}
          </button>
        )}
      </div>
      <div
        className={
          editMode ? "flex-1 overflow-hidden p-2" : "flex-1 overflow-auto p-4"
        }
      >
        {editMode ? (
          <CodeEditor
            value={draft}
            path={path}
            onChange={setDraft}
            onSave={save}
          />
        ) : isBinaryImage ? (
          <div className="flex items-center justify-center">
            <img
              src={`data:${mime};base64,${content}`}
              alt={filename ?? "image"}
              className="max-w-full max-h-[calc(100dvh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isPdf && pdfBlobUrl ? (
          <iframe
            src={pdfBlobUrl}
            title={filename ?? "pdf"}
            className="w-full h-[calc(100dvh-200px)] rounded border border-border-light bg-white"
          />
        ) : /* tooLarge must come before the `binary` arm: PAYLOAD_TOO_LARGE
           comes back with binary:true and content:"" so the hex-dump path
           would otherwise render an empty buffer. */ tooLarge ? (
          <div className="py-12 text-center text-[13px] text-text-muted">
            <p>File too large to preview</p>
            <p className="mt-1 text-[11px]">
              Files over 10 MB cannot be displayed
            </p>
          </div>
        ) : binary ? (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                Binary file — hex dump
              </p>
              {mime && (
                <p className="text-[11px] font-mono text-text-muted">{mime}</p>
              )}
            </div>
            <p className="mb-3 text-[11px] text-text-muted">
              This file is not directly viewable. The first bytes are shown
              below.
            </p>
            <pre className="text-[11px] font-mono leading-[1.6] text-text-secondary whitespace-pre overflow-x-auto">
              {hexDump(content)}
            </pre>
          </div>
        ) : isSvg && renderSvg ? (
          <div className="flex items-center justify-center">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
              alt={filename ?? "image"}
              className="max-w-full max-h-[calc(100dvh-200px)] object-contain rounded border border-border-light"
            />
          </div>
        ) : isMarkdown && renderMd ? (
          <Markdown onFileClick={onOpenFile}>{content}</Markdown>
        ) : (
          <HighlightedCode code={content} path={path} />
        )}
      </div>
    </div>
  );
}
