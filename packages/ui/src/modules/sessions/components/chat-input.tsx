import {
  Attachment as Paperclip,
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
import { emitToast } from "../../../lib/toast.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const BUSY_VERBS = [
  "Bamboozling",
  "Bamming",
  "Cowabunga-ing",
  "Gadzooksing",
  "Gee whizzing",
  "Gee willikering",
  "Gollying",
  "Great Scotting",
  "Holy guacamoleing",
  "Holy mackereling",
  "Holy moleying",
  "Hot diggitying",
  "Jeepersing",
  "Jiminy cricketing",
  "Kablooeying",
  "Kabooming",
  "Kapowing",
  "Kersplatting",
  "Klonking",
  "Leapin' lizarding",
  "Powieing",
  "Sakes aliving",
  "Shazaming",
  "Thwacking",
  "Up-up-and-awaying",
  "Vrooming",
  "Whamming",
  "Whiz-banging",
  "Whomping",
  "Zlonking",
  "Zonking",
  "Zwapping",
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

  useAutoResize(textareaRef, input);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      // Mirror the server-side 10 MB cap so oversized files never get
      // base64-encoded into memory just to fail on upload.
      if (file.size > MAX_UPLOAD_BYTES) {
        emitToast({
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
  }, []);

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
      className={`border-t bg-card/50 backdrop-blur-xl px-4 md:px-8 py-3 transition-colors ${dragOver ? "border-primary bg-primary/10" : "border-border"}`}
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
          <Button
            variant="outline"
            size="icon"
            className="h-[44px] w-[44px] text-muted-foreground hover:text-primary hover:border-primary shrink-0 disabled:opacity-40"
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingSession}
            title="Attach file"
          >
            <Paperclip size={16} />
          </Button>
          {attachments.length > 0 ? (
            <div className="flex-1 rounded-lg border border-primary bg-background shadow-[0_0_0_3px_var(--color-accent-glow)] transition-all focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--color-accent-glow)]">
              <div className="flex gap-2 flex-wrap px-3 pt-3">
                {attachments.map((a, i) => (
                  <AttachmentChip
                    key={i}
                    attachment={a}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
              </div>
              <Textarea
                ref={textareaRef}
                className="w-full bg-transparent border-0 px-4 py-2 text-[14px] text-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden placeholder:text-muted-foreground disabled:opacity-40 focus-visible:ring-0 focus-visible:ring-offset-0"
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
            <Textarea
              ref={textareaRef}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-[14px] text-foreground resize-none min-h-[44px] max-h-[50vh] overflow-hidden transition-all focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-muted-foreground disabled:opacity-40"
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
            <Button
              variant="destructive"
              size="icon"
              className="h-[44px] w-[44px] shrink-0"
              onClick={onStop}
              title="Stop"
            >
              <Square size={16} />
            </Button>
          )}
          {showSend && (
            <Button
              size="icon"
              className="h-[44px] w-[44px] disabled:opacity-40 shrink-0"
              onClick={send}
              disabled={sendDisabled || loadingSession}
              title={isComputing ? "Queue" : "Send"}
            >
              <SendIcon size={16} />
            </Button>
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
          className="h-14 w-14 rounded-md border border-border object-cover"
        />
      ) : (
        <div className="h-14 px-3 rounded-md border border-border bg-muted flex items-center gap-2">
          <FileIcon size={14} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-foreground/80 truncate max-w-[120px]">
            {attachment.name}
          </span>
        </div>
      )}
      <Button
        variant="destructive"
        size="icon"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={10} />
      </Button>
    </div>
  );
}
