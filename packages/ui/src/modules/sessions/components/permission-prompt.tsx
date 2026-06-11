import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import type { PermissionOption } from "../../../store.js";
import { useStore } from "../../../store.js";

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

function optionAccent(kind?: string): string {
  if (kind === "allow_always" || kind === "allow_once") {
    return "hover:border-primary hover:text-primary";
  }
  if (kind === "reject_always" || kind === "reject_once") {
    return "hover:border-destructive hover:text-destructive";
  }
  return "hover:border-primary hover:text-primary";
}

/**
 * Inline permission prompt. Sits in place of the chat input while the agent
 * is waiting on a tool approval. There is no dismiss/cancel that reaches the
 * agent — closing the tab, reloading, or navigating away just hides the UI
 * locally. The server-side buffer keeps the request pending and re-shows the
 * prompt on the next attach. Only clicking an option (or pressing its number)
 * sends a response to the agent.
 */
export function PermissionPrompt() {
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
      const opt = current.options[num - 1];
      resolve(current.toolCallId, {
        outcome: { outcome: "selected", optionId: opt.optionId },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, resolve]);

  if (!current) return null;

  const pick = (opt: PermissionOption) =>
    resolve(current.toolCallId, {
      outcome: { outcome: "selected", optionId: opt.optionId },
    });

  return (
    <div className="border-t bg-card/50 backdrop-blur-xl px-4 md:px-8 py-3">
      <div className="mx-auto max-w-[760px] rounded-lg border-2 border-primary bg-background p-3.5 flex flex-col gap-2 shadow-sm">
        <div className="text-[14px] font-bold text-foreground break-all">
          Allow{" "}
          <span className="text-primary">{toolTitle(current.toolCall)}</span>?
        </div>
        <div className="flex flex-col gap-1.5">
          {current.options.map((opt, i) => (
            <Button
              key={opt.optionId}
              variant="outline"
              onClick={() => pick(opt)}
              className={`h-auto items-start justify-start gap-3 whitespace-normal rounded-md border-2 border-border bg-card px-3 py-2 text-left text-[13px] text-foreground ${optionAccent(opt.kind)}`}
            >
              <span className="text-muted-foreground font-mono text-[11px] w-4 shrink-0">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 break-words">{opt.name}</span>
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
    </div>
  );
}
