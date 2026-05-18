import { useCallback, useEffect, useRef } from "react";

import { useStore } from "../../../store.js";

const badgeStyle: Record<string, string> = {
  text: "bg-bg text-text-muted border-border-light",
  tool: "bg-accent-light text-accent border-accent",
  done: "bg-success-light text-success border-success",
  error: "bg-danger-light text-danger border-danger",
  prompt: "bg-info-light text-info border-info",
  session: "bg-bg text-text-muted border-border-light",
};

export function LogPanel() {
  const log = useStore((s) => s.log);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    if (isAtBottomRef.current)
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex flex-1 flex-col overflow-y-auto"
    >
      {log.length === 0 && (
        <p className="px-4 py-5 text-[12px] text-text-muted">No events yet</p>
      )}
      {log.map((e) => (
        <div
          key={e.id}
          className="flex flex-col gap-1 border-b border-border-light px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-text-muted">
              {e.ts}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.05em] border-2 rounded-full px-2 py-0.5 ${badgeStyle[e.type] ?? "bg-bg text-text-muted border-border-light"}`}
            >
              {e.type}
            </span>
          </div>
          <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all leading-[1.5] max-h-[100px] overflow-y-auto">
            {JSON.stringify(e.payload, null, 2)}
          </pre>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
