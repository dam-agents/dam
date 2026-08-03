import { Checkmark, Close } from "@carbon/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PermissionOption } from "../../../store.js";
import { useStore } from "../../../store.js";
import type { VerdictPart } from "../../../types.js";
import { ChatColumn } from "./chat-column.js";

export type PermissionVerdict = Omit<VerdictPart, "kind">;

function toolTitle(toolCall: unknown): string {
  if (toolCall && typeof toolCall === "object") {
    const tc = toolCall as {
      title?: string;
      kind?: string;
      toolCallId?: string;
    };
    return tc.title ?? tc.kind ?? "this tool call";
  }
  return "this tool call";
}

function toolLocation(toolCall: unknown): string | null {
  if (toolCall && typeof toolCall === "object") {
    const tc = toolCall as { locations?: { path?: string }[] };
    return tc.locations?.[0]?.path ?? null;
  }
  return null;
}

function verdictLabel(opt: PermissionOption): string {
  switch (opt.kind) {
    case "allow_once":
      return "Allowed once";
    case "allow_always":
      return "Always allowed";
    case "reject_once":
      return "Denied";
    case "reject_always":
      return "Always denied";
    default:
      return opt.name;
  }
}

/** Transcript-side note for a pending approval — rendered at the end of the
 *  agent response while the blocking prompt occupies the input slot. Renders
 *  nothing when the viewed session has no pending request. */
export function PermissionStatusLine() {
  const sessionId = useStore((s) => s.sessionId);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const current = sessionId
    ? pendingPermissions.find((p) => p.sessionId === sessionId)
    : undefined;
  if (!current) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 min-h-11 text-sm anim-in">
      <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
      <span className="text-muted-foreground shrink-0">
        Awaiting approval —
      </span>
      <span className="font-semibold text-foreground truncate">
        Allow {toolTitle(current.toolCall)}
      </span>
    </div>
  );
}

/** A resolved verdict, rendered in the transcript where the user decided it. */
export function PermissionVerdictLine({ verdict }: { verdict: VerdictPart }) {
  return (
    <div className="flex w-full items-center gap-2 rounded-lg bg-muted px-4 min-h-11 text-sm anim-in">
      {verdict.allowed ? (
        <Checkmark size={16} className="text-success shrink-0" />
      ) : (
        <Close size={16} className="text-destructive shrink-0" />
      )}
      <span className="text-muted-foreground shrink-0">{verdict.label} —</span>
      <span className="font-semibold text-foreground truncate">
        {verdict.subject}
      </span>
    </div>
  );
}

/**
 * Inline permission prompt. Sits in place of the chat input while the agent
 * is waiting on a tool approval. There is no dismiss/cancel that reaches the
 * agent — closing the tab, reloading, or navigating away just hides the UI
 * locally. The server-side buffer keeps the request pending and re-shows the
 * prompt on the next attach. Only clicking an option (or pressing its number)
 * sends a response to the agent.
 */
export function PermissionPrompt({
  onResolved,
}: {
  onResolved?: (verdict: PermissionVerdict, toolCallId: string) => void;
}) {
  // Only show requests tied to the session the user is currently viewing.
  // Other sessions may have pending permissions buffered on the runtime and
  // replayed into this global list; those belong to their own chat views.
  // Select the raw array (stable reference) and filter during render — a
  // selector that returns `.filter(...)` mints a new array per call and
  // trips React's `getSnapshot should be cached` check, causing an
  // infinite re-render loop.
  const sessionId = useStore((s) => s.sessionId);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const resolve = useStore((s) => s.resolvePendingPermission);
  const pending = sessionId
    ? pendingPermissions.filter((p) => p.sessionId === sessionId)
    : [];
  const current = pending[0];

  const titleRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);

  useEffect(() => setExpanded(false), [current?.toolCallId]);

  // Show the toggle only when the title actually overflows the clamp. Skip
  // measuring while expanded (scrollHeight equals clientHeight then), so the
  // "Show less" affordance doesn't vanish.
  useEffect(() => {
    if (expanded) return;
    const el = titleRef.current;
    setClampable(!!el && el.scrollHeight > el.clientHeight + 1);
  }, [expanded, current?.toolCallId]);

  const pick = useCallback(
    (opt: PermissionOption) => {
      if (!current) return;
      onResolved?.(
        {
          label: verdictLabel(opt),
          subject: toolTitle(current.toolCall),
          allowed: opt.kind?.startsWith("allow") ?? false,
        },
        current.toolCallId,
      );
      resolve(current.toolCallId, {
        outcome: { outcome: "selected", optionId: opt.optionId },
      });
    },
    [current, resolve, onResolved],
  );

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing elsewhere so digit input doesn't select options.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const num = Number.parseInt(e.key, 10);
      if (Number.isNaN(num)) return;
      if (num < 1 || num > current.options.length) return;
      e.preventDefault();
      pick(current.options[num - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pick]);

  if (!current) return null;

  const title = toolTitle(current.toolCall);
  const location = toolLocation(current.toolCall);

  return (
    <div className="px-4 md:px-8 pt-3 pb-4">
      <ChatColumn className="flex flex-col gap-2">
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3.5 flex flex-col gap-3">
          <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-accent shrink-0 mt-1.5" />
            <span
              ref={titleRef}
              className={cn("break-all min-w-0", !expanded && "line-clamp-3")}
            >
              Allow {title}?
            </span>
          </div>
          {(clampable || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="self-start pl-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {location && (
            <div className="pl-4 text-sm text-muted-foreground break-all">
              {location}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {current.options.map((opt, i) => (
              <Button
                key={opt.optionId}
                variant="outline"
                size="sm"
                onClick={() => pick(opt)}
                className="bg-background h-[26px] text-sm font-medium max-w-full"
                tooltip={`${opt.name} — press ${i + 1}`}
              >
                <span className="truncate">{opt.name}</span>
              </Button>
            ))}
          </div>
          {pending.length > 1 && (
            <div className="text-[11px] text-muted-foreground">
              {pending.length - 1} more request
              {pending.length - 1 === 1 ? "" : "s"} queued
            </div>
          )}
        </div>
      </ChatColumn>
    </div>
  );
}
