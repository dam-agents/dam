import {
  Add,
  Close as X,
  Document as FileIcon,
  Send as SendIcon,
  Stop as Square,
} from "@carbon/icons-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { isMobile } from "../../../lib/breakpoints.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const BUSY_VERBS = [
  "Thinking",
  "Processing",
  "Analyzing",
  "Working",
  "Generating",
  "Reasoning",
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
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className="inline-flex gap-0.5">
        <span
          className="w-1 h-1 rounded-full bg-primary anim-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-primary anim-pulse"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="w-1 h-1 rounded-full bg-primary anim-pulse"
          style={{ animationDelay: "400ms" }}
        />
      </span>
      {verb}…
    </span>
  );
}

interface ChatInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
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
  const showToast = useCallback((opts: { kind: string; message: string }) => {
    console.warn(`[${opts.kind}] ${opts.message}`);
  }, []);

  useAutoResize(textareaRef, input);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
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
  const showStop = isComputing;
  const showSend = !isComputing || hasContent;
  const sendDisabled = !isComputing && !hasContent;

  const send = useCallback(() => {
    const text = input.trim();
    const files = attachments.length > 0 ? attachments : undefined;
    if (!text && !files) return;
    setInput("");
    setAttachments([]);
    onSend(text, files);
  }, [input, attachments, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
      e.preventDefault();
      send();
    }
  };

  const placeholder = isComputing ? "Queue a follow-up…" : "Message…";

  return (
    <div
      className={`px-4 md:px-8 py-4 transition-colors ${dragOver ? "bg-primary/5" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-[680px]">
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

        {/* Floating input container */}
        <div
          className={`rounded-lg border bg-card transition-all ${
            dragOver
              ? "border-primary"
              : "border-border focus-within:border-primary"
          }`}
        >
          {/* Attachments row */}
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap px-4 pt-3">
              {attachments.map((a, i) => (
                <AttachmentChip
                  key={i}
                  attachment={a}
                  onRemove={() => removeAttachment(i)}
                />
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-end gap-1 px-2 py-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingSession}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-30 shrink-0"
              title="Attach file"
            >
              <Add size={16} />
            </button>

            <Textarea
              ref={textareaRef}
              className="flex-1 bg-transparent border-0 px-2 py-2 text-[14px] text-foreground resize-none min-h-[36px] max-h-[200px] overflow-hidden placeholder:text-muted-foreground/60 disabled:opacity-40 focus-visible:ring-0 focus-visible:ring-offset-0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={1}
              disabled={loadingSession}
            />

            <div className="flex items-center gap-1 shrink-0">
              {showStop && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/10"
                  onClick={onStop}
                  title="Stop"
                >
                  <Square size={16} />
                </Button>
              )}
              {showSend && (
                <Button
                  size="icon"
                  className="h-9 w-9 rounded-xl disabled:opacity-30 shrink-0"
                  onClick={send}
                  disabled={sendDisabled || loadingSession}
                  title={isComputing ? "Queue" : "Send"}
                >
                  <SendIcon size={16} />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Footer row */}
        <div className="flex items-center gap-3 min-h-[24px] px-2 mt-1.5">
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
          className="h-12 w-12 rounded-lg border border-border object-cover"
        />
      ) : (
        <div className="h-10 px-3 rounded-lg border border-border bg-muted/30 flex items-center gap-2">
          <FileIcon size={13} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-foreground/80 truncate max-w-[100px]">
            {attachment.name}
          </span>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={8} />
      </button>
    </div>
  );
}
