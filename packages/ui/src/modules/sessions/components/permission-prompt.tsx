import { Checkmark, Close, Copy, Warning } from "@carbon/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { useCopy } from "@/hooks/use-copy";
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

export function PermissionVerdictLine({ verdict }: { verdict: VerdictPart }) {
  const [expanded, setExpanded] = useState(false);
  const { copy, copied, state: copyState } = useCopy();

  return (
    <div
      className="group flex w-full items-start justify-between gap-2 rounded-lg bg-muted px-4 py-3 min-h-11 text-sm anim-in cursor-pointer"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {verdict.allowed ? (
          <Checkmark size={16} className="text-success shrink-0 mt-0.5" />
        ) : (
          <Close size={16} className="text-destructive shrink-0 mt-0.5" />
        )}
        <span className="text-muted-foreground shrink-0">
          {verdict.label} —
        </span>
        <span
          className={cn(
            "font-semibold text-foreground min-w-0 select-text",
            expanded ? "whitespace-pre-wrap break-words" : "truncate",
          )}
          title={verdict.subject}
        >
          {verdict.subject}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? "Copied" : "Copy"}
        tooltip={copied ? "Copied" : "Copy"}
        onClick={(e) => {
          e.stopPropagation();
          void copy(`${verdict.label} — ${verdict.subject}`);
        }}
        className={cn(
          "text-muted-foreground hover:text-foreground shrink-0",
          HOVER_ACTION,
          copied && "text-success hover:text-success opacity-100",
          copyState === "failed" && "text-danger hover:text-danger opacity-100",
        )}
      >
        {copied ? (
          <Checkmark size={12} />
        ) : copyState === "failed" ? (
          <Warning size={12} />
        ) : (
          <Copy size={12} />
        )}
      </Button>
    </div>
  );
}

export function PermissionPrompt({
  onResolved,
}: {
  onResolved?: (verdict: PermissionVerdict, toolCallId: string) => void;
}) {
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
