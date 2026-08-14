import { SectionLabel } from "@/components/ui/section-label";

import { HighlightedCode } from "../../../components/highlighted-code.js";
import { Markdown } from "../../../components/markdown.js";
import type { FileContent } from "../api/queries.js";
import { CodeEditor } from "./code-editor.js";

interface Props {
  file: FileContent;
  editMode: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  renderSvg: boolean;
  renderMd: boolean;
  renderHtml: boolean;
  pdfBlobUrl: string | null;
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

function isImageMime(mime: string | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

export function FilePreviewBody({
  file,
  editMode,
  draft,
  onDraftChange,
  onSave,
  renderSvg,
  renderMd,
  renderHtml,
  pdfBlobUrl,
  onOpenFile,
}: Props) {
  const { path, content, binary, mimeType: mime, tooLarge } = file;
  const filename = path.split("/").pop();
  const isSvg = mime === "image/svg+xml";
  const isMarkdown = mime === "text/markdown";
  const isHtml = mime === "text/html";
  const isPdf = mime === "application/pdf";
  const isBinaryImage = binary && content && isImageMime(mime) && !isSvg;

  if (editMode) {
    return (
      <CodeEditor
        value={draft}
        path={path}
        onChange={onDraftChange}
        onSave={onSave}
      />
    );
  }
  if (isBinaryImage) {
    return (
      <div className="flex items-center justify-center">
        <img
          src={`data:${mime};base64,${content}`}
          alt={filename ?? "image"}
          className="max-w-full max-h-[calc(100dvh-200px)] object-contain rounded border border-border"
        />
      </div>
    );
  }
  if (isPdf && pdfBlobUrl) {
    return (
      <iframe
        src={pdfBlobUrl}
        title={filename ?? "pdf"}
        className="w-full h-[calc(100dvh-200px)] rounded border border-border bg-white"
      />
    );
  }
  if (tooLarge) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <p>File too large to preview</p>
        <p className="mt-1 text-[11px]">
          The agent refused to read it at this size — open it in a terminal
          instead
        </p>
      </div>
    );
  }
  if (binary) {
    return (
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <SectionLabel>Binary file — hex dump</SectionLabel>
          {mime && (
            <p className="text-[11px] font-mono text-muted-foreground">
              {mime}
            </p>
          )}
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          This file is not directly viewable. The first bytes are shown below.
        </p>
        <pre className="text-[11px] font-mono leading-[1.6] text-foreground/80 whitespace-pre overflow-x-auto">
          {hexDump(content)}
        </pre>
      </div>
    );
  }
  if (isSvg && renderSvg) {
    return (
      <div className="flex items-center justify-center">
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
          alt={filename ?? "image"}
          className="max-w-full max-h-[calc(100dvh-200px)] object-contain rounded border border-border"
        />
      </div>
    );
  }
  if (isMarkdown && renderMd) {
    return <Markdown onFileClick={onOpenFile}>{content}</Markdown>;
  }
  if (isHtml && renderHtml) {
    return (
      <iframe
        srcDoc={content}
        title={filename ?? "html"}
        sandbox="allow-scripts"
        className="w-full h-[calc(100dvh-200px)] rounded border border-border bg-white"
      />
    );
  }
  return <HighlightedCode code={content} path={path} />;
}
