import {
  CheckmarkFilled,
  Close,
  Cube,
  Document,
  SendAltFilled,
  Stop,
} from "@carbon/icons-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format-size";
import { cn } from "@/lib/utils";

import { useAutoResize } from "../../../hooks/use-auto-resize.js";
import { useNow } from "../../../hooks/use-now.js";
import { isMobile } from "../../../lib/breakpoints.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import type { Attachment } from "../../../types.js";
import { MAX_UPLOAD_BYTES } from "../../files/api/queries.js";
import { useInstantStart } from "../../instant-start/context.js";
import { useProcesses } from "../../processes/api/queries.js";
import { formatRunTime } from "../../processes/lib/format-process.js";
import { summarizeProcesses } from "../../processes/lib/process-summary.js";
import { draftKey, EMPTY_DRAFT } from "../lib/draft-key.js";
import { ChatColumn } from "./chat-column.js";
import { PlusMenuPopover } from "./plus-menu-popover.js";
import { WorkingDots } from "./working-dots.js";

const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"];

import { PACKS, REAL_PACKS } from "../../packs/data/packs.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import type { RotatingPlaceholder } from "../../schedules/components/schedule-chat-discovery.js";

function StarterKitStrip({
  onScrollToMessage,
}: {
  onScrollToMessage?: (messageId: string) => void;
}) {
  const kitMode = useStore((s) => s.starterKitMode);
  const selectedKitId = useStore((s) => s.selectedStarterKitId);
  const realPacks = useStore((s) => s.realPacks);
  const steps = useStore((s) => s.currentTranscriptSteps);
  const currentStep = useStore((s) => s.onboardingStep);

  if (!kitMode) return null;
  if (steps.length === 0 || currentStep >= steps.length) return null;

  const allPacks = realPacks ? REAL_PACKS : PACKS;
  const pack = allPacks.find((p) => p.id === selectedKitId) ?? allPacks[0];
  if (!pack) return null;

  const done = currentStep;
  const remaining = steps.length - done;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-preset-border/30 bg-preset-light/30 px-3 py-2">
      <Cube size={16} className="shrink-0 text-preset" />
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {pack.name}
      </span>
      <HoverCard openDelay={150} closeDelay={300}>
        <HoverCardTrigger asChild>
          <Badge
            variant="preset"
            className="ml-auto shrink-0 cursor-default gap-1"
          >
            {remaining} remaining
          </Badge>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="end" className="w-72 p-0">
          <div className="px-4 pt-3.5 pb-3">
            <p className="text-sm font-semibold text-foreground">{pack.name}</p>
            <p className="text-sm text-muted-foreground">
              {done} of {steps.length} done
            </p>
          </div>
          <ul className="border-t border-border py-1.5">
            {steps.map((step, i) => (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() =>
                    step.firstMessageId &&
                    onScrollToMessage?.(step.firstMessageId)
                  }
                  className="flex w-full items-center gap-3 rounded-md px-4 py-1.5 transition-colors hover:bg-muted/40"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {i < currentStep ? (
                      <CheckmarkFilled size={16} className="text-success" />
                    ) : (
                      <span className="size-4 rounded-full border-2 border-border" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-sm",
                      i < currentStep
                        ? "text-muted-foreground"
                        : "text-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {step.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

export interface ChatInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  loadingSession: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  rotatingPlaceholder?: RotatingPlaceholder | null;
  onConfigureSection?: (section: SandboxSection) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export function ChatInput({
  textareaRef,
  busy,
  loadingSession,
  onSend,
  onStop,
  rotatingPlaceholder,
  onConfigureSection,
  onScrollToMessage,
}: ChatInputProps) {
  const agentId = useStore((s) => s.selectedAgent);
  const sessionId = useStore((s) => s.sessionId);
  const kitMode = useStore((s) => s.starterKitMode);
  const transcriptSteps = useStore((s) => s.currentTranscriptSteps);
  const onboardingStep = useStore((s) => s.onboardingStep);
  const setDraft = useStore((s) => s.setDraft);
  const clearDraft = useStore((s) => s.clearDraft);
  const key = agentId ? draftKey(agentId, sessionId) : null;
  const draft = useStore((s) =>
    key ? (s.drafts[key] ?? EMPTY_DRAFT) : EMPTY_DRAFT,
  );
  const input = draft.text;
  const attachments = draft.attachments;

  const instantStart = useInstantStart();
  const budgetLocked =
    instantStart?.budgetExhausted &&
    instantStart.activeProvider === "curvebender" &&
    instantStart.curveBenderPayment === "free";

  const composerLocked = useMemo(() => {
    if (!kitMode) return false;
    return (
      transcriptSteps.length > 0 && onboardingStep < transcriptSteps.length
    );
  }, [kitMode, transcriptSteps, onboardingStep]);

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
  const showRotating = !hasInput && rotatingPlaceholder != null;

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
    if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
      e.preventDefault();
      send();
    }
    if (e.key === "Tab" && showRotating && key) {
      e.preventDefault();
      setDraft(key, { text: rotatingPlaceholder!.text });
    }
  };

  const placeholder = composerLocked
    ? "Complete the setup form above to continue"
    : isComputing
      ? "Queue a message..."
      : "Message...";

  return (
    <div
      className="pt-3 pb-1"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ChatColumn className="px-4 md:px-8 flex flex-col gap-1.5">
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
        <StarterKitStrip onScrollToMessage={onScrollToMessage} />
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
            <PlusMenuPopover
              agentId={agentId}
              disabled={loadingSession || !key}
              onAttachFile={() => fileInputRef.current?.click()}
              onConfigureSection={onConfigureSection}
              onPrefillInput={(text) => {
                if (!key) return;
                setDraft(key, { text });
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            />
            <div className="relative flex-1">
              {showRotating && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-[17px] flex items-center justify-between text-sm leading-[22px] transition-opacity duration-500",
                    rotatingPlaceholder!.fading && "opacity-0",
                  )}
                >
                  <span className="truncate text-muted-foreground/50">
                    {rotatingPlaceholder!.text}
                  </span>
                  <kbd className="shrink-0 mr-2 inline-flex h-5 items-center rounded border border-border/50 px-1.5 text-[11px] text-muted-foreground/50">
                    Tab
                  </kbd>
                </span>
              )}
              <Textarea
                ref={textareaRef}
                className="relative z-[1] w-full bg-transparent border-0 pl-0 pr-2 py-[17px] text-sm leading-[22px] text-foreground caret-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden disabled:opacity-40 focus-visible:ring-0 focus-visible:ring-offset-0"
                value={input}
                onChange={(e) => key && setDraft(key, { text: e.target.value })}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={showRotating ? "" : placeholder}
                rows={1}
                disabled={
                  loadingSession || !key || composerLocked || budgetLocked
                }
                autoFocus
              />
            </div>
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
                disabled={
                  sendDisabled || loadingSession || !key || budgetLocked
                }
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

export function BackgroundTasksIndicator({
  agentId,
}: {
  agentId: string | null;
}) {
  const { data } = useProcesses(agentId, { enabled: !!agentId, poll: false });
  const now = useNow(5_000);

  const background = useMemo(
    () => (data ? data.running.filter((r) => r.kind !== "turn") : []),
    [data],
  );

  const { running } = data ? summarizeProcesses(data) : { running: 0 };
  if (running === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <WorkingDots size="sm" className="text-success" />
          <span>
            {running} background {running === 1 ? "task" : "tasks"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-3">
        <p className="mb-2 text-sm font-semibold text-foreground">
          Background tasks
        </p>
        <div className="flex flex-col gap-2">
          {background.map((row) => {
            const sessionId = (row as typeof row & { sessionId?: string })
              .sessionId;
            return (
              <div
                key={row.key}
                className="flex flex-col gap-0.5 rounded-md p-1.5"
              >
                <code className="font-mono text-sm text-foreground truncate max-w-full">
                  {row.command}
                </code>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatRunTime(row.startedAt, now)}</span>
                  {sessionId && (
                    <>
                      <span aria-hidden>&middot;</span>
                      <span className="truncate">{sessionId}</span>
                    </>
                  )}
                </div>
                {row.keepsAwake ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                    Keeps agent awake
                  </span>
                ) : (
                  <span className="text-xs text-warning">
                    May stop when the agent sleeps
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
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
