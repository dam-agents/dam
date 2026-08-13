import { Add, Close, Document, SendAltFilled, Stop } from "@carbon/icons-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { emitToast } from "../../../lib/toast.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";
import { ChatColumn } from "./chat-column.js";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface ChatInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  loadingSession: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
}

export function ChatInput({
  textareaRef,
  busy,
  loadingSession,
  onSend,
  onStop,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useAutoResize(textareaRef, input);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
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

  const placeholder = isComputing ? "Queue a message..." : "Message...";

  return (
    <div
      className="px-4 md:px-8 pt-3 pb-1"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ChatColumn className="flex flex-col gap-1.5">
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
        <div
          className={`flex flex-col rounded-xl border bg-background transition-colors focus-within:border-primary ${dragOver ? "border-primary bg-accent-light/30" : "border-border"}`}
        >
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap px-3 pt-3">
              {attachments.map((a, i) => (
                <AttachmentChip
                  key={i}
                  attachment={a}
                  onRemove={() => removeAttachment(i)}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-1 px-2 min-h-[56px]">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 mb-[9px] h-10 w-10 text-muted-foreground hover:text-primary disabled:opacity-40"
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingSession}
              aria-label="Attach file"
              tooltip="Attach file"
            >
              <Add size={16} />
            </Button>
            <Textarea
              ref={textareaRef}
              className="flex-1 bg-transparent border-0 pl-0 pr-2 py-[17px] text-sm leading-[22px] text-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden disabled:opacity-40 focus-visible:ring-0 focus-visible:ring-offset-0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={1}
              disabled={loadingSession}
            />
            {showStop && (
              <Button
                variant="ghost"
                tone="danger"
                size="icon-sm"
                className="shrink-0 mb-[9px] h-10 w-10"
                onClick={onStop}
                aria-label="Stop"
                tooltip="Stop"
              >
                <Stop size={16} />
              </Button>
            )}
            {showSend && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`shrink-0 mb-[9px] h-10 w-10 ${hasContent ? "text-foreground" : "text-muted-foreground"} disabled:opacity-40`}
                onClick={send}
                disabled={sendDisabled || loadingSession}
                aria-label={isComputing ? "Queue" : "Send"}
                tooltip={isComputing ? "Queue" : "Send"}
              >
                <SendAltFilled size={16} />
              </Button>
            )}
          </div>
        </div>
      </ChatColumn>
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
          <Document size={14} className="text-muted-foreground shrink-0" />
          <span className="text-[11px] text-foreground/80 truncate max-w-[120px]">
            {attachment.name}
          </span>
        </div>
      )}
      <Button
        variant="destructive"
        size="icon"
        onClick={onRemove}
        aria-label="Remove attachment"
        className={cn(
          "absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full",
          HOVER_ACTION,
        )}
      >
        <Close size={10} />
      </Button>
    </div>
  );
}
