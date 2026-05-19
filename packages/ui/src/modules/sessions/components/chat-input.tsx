import {
  FileText as FileIcon,
  Paperclip,
  Send as SendIcon,
  Square,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { useStore } from "../../../store.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const BUSY_VERBS = [
  "Clawing",
  "Pinching",
  "Molting",
  "Shellscheming",
  "Pincerpondering",
  "Lobstering",
  "Buttermusing",
  "Antennawaving",
  "Tailflicking",
  "Carapacing",
  "Crustaceating",
  "Clawfiddling",
  "Brinebrewing",
  "Shellshocking",
  "Clawmarinating",
  "Pincernoodling",
  "Clawculating",
  "Crustigitating",
  "Claberating",
  "Lobstrifying",
];

function BusyIndicator() {
  const [verb, setVerb] = useState(
    () => BUSY_VERBS[Math.floor(Math.random() * BUSY_VERBS.length)],
  );
  useEffect(() => {
    const id = setInterval(() => {
      setVerb(BUSY_VERBS[Math.floor(Math.random() * BUSY_VERBS.length)]);
    }, 2500);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
      <span className="inline-flex gap-0.5">
        <span
          className="w-1 h-1 rounded-full bg-accent anim-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-accent anim-pulse"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-accent anim-pulse"
          style={{ animationDelay: "400ms" }}
        />
      </span>
      {verb}…
    </span>
  );
}

interface ChatInputProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  busy: boolean;
  loadingSession: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  footer?: ReactNode;
}

export function ChatInput({
  textareaRef,
  busy,
  loadingSession,
  onSend,
  onStop,
  footer,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useStore((s) => s.showToast);

  useAutoResize(textareaRef, input);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        // Mirror the server-side 10 MB cap so oversized files never get
        // base64-encoded into memory just to fail on upload.
        if (file.size > MAX_UPLOAD_BYTES) {
          showToast({
            kind: "error",
            message: `${file.name} exceeds 10 MB — skipped`,
          });
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (!base64) return;
          if (IMAGE_MIME.includes(file.type)) {
            setAttachments((prev) => [
              ...prev,
              { kind: "image", data: base64, mimeType: file.type },
            ]);
          } else {
            setAttachments((prev) => [
              ...prev,
              {
                kind: "file",
                name: file.name,
                data: base64,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
              },
            ]);
          }
        };
        reader.readAsDataURL(file);
      }
    },
    [showToast],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()!)
        .filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const isComputing = busy && !loadingSession;
  const hasInput = input.trim().length > 0;
  const hasContent = hasInput || attachments.length > 0;
  // Always show the stop affordance while busy so the user is never stranded
  // without a way to interrupt. When they also have content typed, keep the
  // send button alongside it so pressing the button queues the follow-up.
  const showStop = isComputing;
  const showSend = !isComputing || hasContent;
  const sendDisabled = !isComputing && !hasContent;

  // Always dispatch — the server-side runtime queues prompts per session, so
  // sending while busy just parks the prompt behind the active one.
  const send = useCallback(() => {
    const text = input.trim();
    const files = attachments.length > 0 ? attachments : undefined;
    if (!text && !files) return;
    setInput("");
    setAttachments([]);
    onSend(text, files);
  }, [input, attachments, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Mobile: Enter inserts newline (send via the button). Desktop: Enter sends, Shift+Enter newlines.
    if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
      e.preventDefault();
      send();
    }
  };

  const placeholder = isComputing ? "Queue a message..." : "Message agent...";

  return (
    <div
      className={`border-t bg-surface/50 backdrop-blur-xl px-4 md:px-8 py-3 transition-colors ${dragOver ? "border-accent bg-accent-light/30" : "border-border-light"}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-[760px] flex flex-col gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex items-end gap-2">
          <button
            className="h-[44px] w-[44px] rounded-lg border border-border-light bg-bg text-text-muted hover:text-accent hover:border-accent shrink-0 flex items-center justify-center transition-colors disabled:opacity-40"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingSession}
            title="Attach file"
          >
            <Paperclip size={16} />
          </button>
          {attachments.length > 0 ? (
            <div className="flex-1 rounded-lg border border-accent bg-bg shadow-[0_0_0_3px_var(--color-accent-glow)] transition-all focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-glow)]">
              <div className="flex gap-2 flex-wrap px-3 pt-3">
                {attachments.map((a, i) => (
                  <AttachmentChip
                    key={i}
                    attachment={a}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="w-full bg-transparent px-4 py-2 text-[14px] text-text outline-none resize-none max-h-[50vh] overflow-hidden placeholder:text-text-muted disabled:opacity-40"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={placeholder}
                rows={1}
                disabled={loadingSession}
              />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="flex-1 rounded-lg border border-border-light bg-bg px-4 py-3 text-[14px] text-text outline-none resize-none min-h-[44px] max-h-[50vh] overflow-hidden transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted disabled:opacity-40"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={1}
              disabled={loadingSession}
            />
          )}
          {showStop && (
            <button
              className="btn-brutal h-[44px] w-[44px] rounded-lg border-2 border-danger bg-danger text-white shrink-0 flex items-center justify-center shadow-[3px_3px_0_var(--c-danger)]"
              onClick={onStop}
              title="Stop"
            >
              <Square size={16} />
            </button>
          )}
          {showSend && (
            <button
              className="btn-brutal h-[44px] w-[44px] rounded-lg border-2 border-accent-hover bg-accent text-white disabled:opacity-40 shrink-0 flex items-center justify-center shadow-brutal-accent"
              onClick={send}
              disabled={sendDisabled || loadingSession}
              title={isComputing ? "Queue" : "Send"}
            >
              <SendIcon size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 min-h-[24px]">
          {footer}
          {isComputing && <BusyIndicator />}
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  return (
    <div className="relative group">
      {attachment.kind === "image" ? (
        <img
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
          alt="attachment"
          className="h-14 w-14 rounded-md border border-border-light object-cover"
        />
      ) : (
        <div className="h-14 px-3 rounded-md border border-border-light bg-surface-raised flex items-center gap-2">
          <FileIcon size={14} className="text-text-muted shrink-0" />
          <span className="text-[11px] text-text-secondary truncate max-w-[120px]">
            {attachment.name}
          </span>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-danger text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={10} />
      </button>
    </div>
  );
}
