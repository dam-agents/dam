import { Add, Close, Document, SendAltFilled, Stop } from "@carbon/icons-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format-size";
import { cn } from "@/lib/utils";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";
import { draftKey, EMPTY_DRAFT } from "../lib/draft-key.js";
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
  const agentId = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const setDraft = useStore((s) => s.setDraft);
  const clearDraft = useStore((s) => s.clearDraft);
  const key = agentId ? draftKey(agentId, sessionId) : null;
  const draft = useStore((s) =>
    key ? (s.drafts[key] ?? EMPTY_DRAFT) : EMPTY_DRAFT,
  );
  const input = draft.text;
  const attachments = draft.attachments;

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useAutoResize(textareaRef, input);

  const consumeDroppedAttachments = useStore(
    (s) => s.consumeDroppedAttachments,
  );
  const droppedNames = draft.droppedAttachmentNames;
  useEffect(() => {
    if (!key || !droppedNames?.length) return;
    const fresh = useStore.getState().drafts[key]?.droppedAttachmentNames;
    if (!fresh?.length) return;
    emitToast({
      kind: "info",
      message: `Draft restored without ${fresh.length} attachment${
        fresh.length === 1 ? "" : "s"
      }: ${fresh.join(", ")}`,
    });
    consumeDroppedAttachments(key);
  }, [key, droppedNames, consumeDroppedAttachments]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!key) return;
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          emitToast({
            kind: "error",
            message: `${file.name} exceeds ${formatBytes(MAX_UPLOAD_BYTES)} — skipped`,
          });
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (!base64) return;
          const attachment: Attachment = IMAGE_MIME.includes(file.type)
            ? { kind: "image", data: base64, mimeType: file.type }
            : {
                kind: "file",
                name: file.name,
                data: base64,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
              };
          const current = useStore.getState().drafts[key] ?? EMPTY_DRAFT;
          setDraft(key, {
            attachments: [...current.attachments, attachment],
          });
        };
        reader.readAsDataURL(file);
      }
    },
    [key, setDraft],
  );

  const removeAttachment = useCallback(
    (index: number) => {
      if (!key) return;
      const current = useStore.getState().drafts[key] ?? EMPTY_DRAFT;
      setDraft(key, {
        attachments: current.attachments.filter((_, i) => i !== index),
      });
    },
    [key, setDraft],
  );

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
    if (!key) return;
    const current = useStore.getState().drafts[key] ?? EMPTY_DRAFT;
    const text = current.text.trim();
    const files =
      current.attachments.length > 0 ? current.attachments : undefined;
    if (!text && !files) return;
    clearDraft(key);
    onSend(text, files);
  }, [key, clearDraft, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (scheduleSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((i) =>
          i < scheduleSuggestions.length - 1 ? i + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((i) =>
          i > 0 ? i - 1 : scheduleSuggestions.length - 1,
        );
        return;
      }
      if (
        (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) &&
        selectedSuggestion >= 0
      ) {
        e.preventDefault();
        const suggestion = scheduleSuggestions[selectedSuggestion];
        if (key && suggestion) {
          setDraft(key, { text: suggestion.prompt });
          setSelectedSuggestion(-1);
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
      e.preventDefault();
      send();
    }
  };

  const IDLE_PLACEHOLDERS = useMemo(
    () => [
      "Message...",
      'Try: "Schedule this to run every morning"',
      "Message...",
      'Try: "Run this on a cron at 9am weekdays"',
      "Message...",
    ],
    [],
  );

  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  useEffect(() => {
    if (isComputing || input.length > 0) return;
    const id = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % IDLE_PLACEHOLDERS.length),
      4000,
    );
    return () => clearInterval(id);
  }, [isComputing, input.length, IDLE_PLACEHOLDERS.length]);

  const placeholder = isComputing
    ? "Queue a message..."
    : IDLE_PLACEHOLDERS[placeholderIdx];

  const scheduleSuggestions = useScheduleSuggestions(input);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  useEffect(() => {
    setSelectedSuggestion(-1);
  }, [scheduleSuggestions.length]);

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
        {scheduleSuggestions.length > 0 && (
          <ScheduleSuggestionsDropdown
            suggestions={scheduleSuggestions}
            selected={selectedSuggestion}
            onSelect={(prompt) => {
              if (!key) return;
              setDraft(key, { text: prompt });
              setSelectedSuggestion(-1);
              textareaRef.current?.focus();
            }}
          />
        )}
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
              disabled={loadingSession || !key}
              aria-label="Attach file"
              tooltip="Attach file"
            >
              <Add size={16} />
            </Button>
            <Textarea
              ref={textareaRef}
              className="flex-1 bg-transparent border-0 pl-0 pr-2 py-[17px] text-sm leading-[22px] text-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden disabled:opacity-40 focus-visible:ring-0 focus-visible:ring-offset-0"
              value={input}
              onChange={(e) => key && setDraft(key, { text: e.target.value })}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={1}
              disabled={loadingSession || !key}
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
                disabled={sendDisabled || loadingSession || !key}
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

interface ScheduleSuggestion {
  label: string;
  prompt: string;
  description: string;
}

const SCHEDULE_COMPLETIONS: ScheduleSuggestion[] = [
  {
    label: "Run every morning",
    prompt: "Schedule this to run every morning at 9am",
    description: "Daily at 9:00 AM",
  },
  {
    label: "Run on weekdays",
    prompt: "Schedule this to run every weekday at 8am",
    description: "Mon–Fri at 8:00 AM",
  },
  {
    label: "Run every hour",
    prompt: "Schedule this to run every hour",
    description: "Repeating hourly",
  },
  {
    label: "Run once a week",
    prompt: "Schedule this to run every Monday at 9am",
    description: "Weekly on Monday",
  },
  {
    label: "Custom schedule",
    prompt: "I'd like to set up a custom schedule — ",
    description: "Describe any cadence in plain language",
  },
];

const TRIGGER_PATTERNS = [
  /\bschedul/i,
  /\bcron\b/i,
  /\bevery\s/i,
  /\bdaily\b/i,
  /\bweekly\b/i,
  /\brecurr/i,
  /\brepeat/i,
  /\brun\s+(this|it|agent)\b/i,
  /\bautomat/i,
];

function useScheduleSuggestions(input: string): ScheduleSuggestion[] {
  return useMemo(() => {
    const trimmed = input.trim();
    if (trimmed.length < 3) return [];
    if (TRIGGER_PATTERNS.some((p) => p.test(trimmed))) {
      return SCHEDULE_COMPLETIONS;
    }
    return [];
  }, [input]);
}

function ScheduleSuggestionsDropdown({
  suggestions,
  selected,
  onSelect,
}: {
  suggestions: ScheduleSuggestion[];
  selected: number;
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          Scheduling — describe any cadence, or pick one:
        </span>
      </div>
      <div className="py-1">
        {suggestions.map((s, i) => (
          <button
            key={s.label}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(s.prompt);
            }}
            className={cn(
              "w-full text-left px-3 py-2 flex items-baseline justify-between gap-3 transition-colors",
              i === selected
                ? "bg-accent-light/50 text-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            <span className="text-sm">{s.label}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {s.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
