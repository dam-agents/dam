import { ArrowDown, FileText as FileIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "../../../components/markdown.js";
import type { SessionError } from "../../../store.js";
import type { Attachment, Message } from "../../../types.js";
import { SendErrorCard } from "./send-error-card.js";
import { SessionErrorCard } from "./session-error-card.js";
import { ThoughtBlock } from "./thought-block.js";
import { ToolChip } from "./tool-chip.js";

interface ChatMessagesProps {
  messages: Message[];
  loadingSession: boolean;
  sessionError: SessionError | null;
  onErrorBack: () => void;
  onErrorDelete: () => void;
  onRetry: (text: string, attachments?: Attachment[]) => void;
  onOpenFile: (path: string) => void;
}

export function ChatMessages({
  messages,
  loadingSession,
  sessionError,
  onErrorBack,
  onErrorDelete,
  onRetry,
  onOpenFile,
}: ChatMessagesProps) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const inner = el.firstElementChild;

    const THRESHOLD = 30;
    const nearBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;

    const onScroll = () => {
      const near = nearBottom();
      stickRef.current = near;
      setShowJump(!near);
    };

    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    if (inner) ro.observe(inner);
    onScroll();

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative flex flex-1 flex-col min-h-0">
      <div ref={messagesRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-4 md:px-6 py-6 flex flex-col gap-5">
          {loadingSession && (
            <div className="py-20 flex items-center justify-center gap-3 text-[14px] text-muted-foreground">
              <span className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 border-t-primary anim-spin" />
              Loading session...
            </div>
          )}
          {!loadingSession && sessionError && (
            <SessionErrorCard
              error={sessionError}
              onBack={onErrorBack}
              onDelete={onErrorDelete}
            />
          )}
          {!loadingSession && !sessionError && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-40">
              <p className="text-[16px] font-semibold text-foreground mb-1">
                Start a conversation
              </p>
              <p className="text-[16px] text-foreground">
                Send a message to begin a new session with this agent
              </p>
            </div>
          )}
          {messages.map((m, mIdx) => {
            const prevMsg = mIdx > 0 ? messages[mIdx - 1] : null;
            const showLabel =
              m.role === "user" ||
              (m.role === "assistant" &&
                (!prevMsg || prevMsg.role !== "assistant" || prevMsg.notice));

            return m.notice ? (
              <div key={m.id} className="flex items-center gap-3 anim-in my-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {m.parts.find((p) => p.kind === "text")?.kind === "text"
                    ? (
                        m.parts.find((p) => p.kind === "text") as {
                          text: string;
                        }
                      ).text
                    : "…"}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            ) : (
              <div
                key={m.id}
                className={`flex flex-col gap-1 anim-in ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                {showLabel && (
                  <span className="text-[11px] font-medium text-muted-foreground mb-0.5">
                    {m.role === "user" ? "You" : "Agent"}
                  </span>
                )}
                {m.error ? (
                  <SendErrorCard
                    error={m.error.message}
                    onRetry={
                      m.error.retryWith
                        ? () =>
                            onRetry(
                              m.error!.retryWith!.text,
                              m.error!.retryWith!.attachments,
                            )
                        : undefined
                    }
                  />
                ) : m.role === "user" ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-3 text-[14px] text-foreground max-w-[620px]">
                    {m.parts.map((p, i) =>
                      p.kind === "text" ? (
                        <span
                          key={i}
                          className="whitespace-pre-wrap break-words"
                        >
                          {p.text}
                          {m.streaming && i === m.parts.length - 1 && (
                            <span className="inline-block w-[7px] h-4 bg-primary ml-0.5 align-text-bottom anim-blink rounded-sm" />
                          )}
                        </span>
                      ) : p.kind === "image" ? (
                        <img
                          key={i}
                          src={`data:${p.mimeType};base64,${p.data}`}
                          alt="image"
                          className="max-w-[400px] max-h-[400px] rounded-lg border border-border object-contain"
                        />
                      ) : p.kind === "file" ? (
                        <div
                          key={i}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2"
                        >
                          <FileIcon
                            size={14}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="text-[12px] text-foreground/80">
                            {p.name}
                          </span>
                          {p.size !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              {p.size < 1024
                                ? `${p.size} B`
                                : `${(p.size / 1024).toFixed(1)} KB`}
                            </span>
                          )}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 max-w-full">
                    {(() => {
                      const actions = m.parts.filter(
                        (p) => p.kind === "tool" || p.kind === "thought",
                      );
                      const content = m.parts.filter(
                        (p) => p.kind !== "tool" && p.kind !== "thought",
                      );
                      return (
                        <>
                          {actions.length > 0 && (
                            <div className="flex flex-col gap-1">
                              {actions.map((p, i) =>
                                p.kind === "thought" ? (
                                  <div
                                    key={i}
                                    className="pl-3 border-l-2 border-muted-foreground/15"
                                  >
                                    <ThoughtBlock
                                      text={p.text}
                                      streaming={m.streaming}
                                    />
                                  </div>
                                ) : p.kind === "tool" ? (
                                  <div
                                    key={i}
                                    className="pl-3 border-l-2 border-muted-foreground/15"
                                  >
                                    <ToolChip chip={p} />
                                  </div>
                                ) : null,
                              )}
                            </div>
                          )}
                          {content.length > 0 && (
                            <div className="flex flex-col gap-2 text-[14px] text-foreground/85">
                              {content.map((p, i) =>
                                p.kind === "text" ? (
                                  <Markdown key={i} onFileClick={onOpenFile}>
                                    {p.text}
                                  </Markdown>
                                ) : p.kind === "image" ? (
                                  <img
                                    key={i}
                                    src={`data:${p.mimeType};base64,${p.data}`}
                                    alt="image"
                                    className="max-w-[400px] max-h-[400px] rounded-lg border border-border object-contain"
                                  />
                                ) : p.kind === "file" ? (
                                  <div
                                    key={i}
                                    className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5"
                                  >
                                    <FileIcon
                                      size={13}
                                      className="text-muted-foreground shrink-0"
                                    />
                                    <span className="text-[13px] text-foreground/80">
                                      {p.name}
                                    </span>
                                    {p.size !== undefined && (
                                      <span className="text-[11px] text-muted-foreground">
                                        {p.size < 1024
                                          ? `${p.size} B`
                                          : `${(p.size / 1024).toFixed(1)} KB`}
                                      </span>
                                    )}
                                  </div>
                                ) : null,
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {m.streaming &&
                      m.parts.length === 0 &&
                      (m.queued ? (
                        <span className="text-[12px] text-muted-foreground italic">
                          Waiting for previous prompt…
                        </span>
                      ) : (
                        <span className="inline-block w-[7px] h-4 bg-primary anim-blink rounded-sm" />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showJump && (
        <button
          onClick={scrollToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground shadow-sm hover:text-foreground hover:border-foreground transition-colors"
        >
          <ArrowDown size={12} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
