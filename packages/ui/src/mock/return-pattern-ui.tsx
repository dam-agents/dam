import { ArrowUp, Code } from "@carbon/icons-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { ChangeCardAttachment } from "./data/transcripts/tools-demo.js";

interface PatternProps {
  totalFiles: number;
  onOpen: () => void;
}

export function ReturnPill({ totalFiles, onOpen }: PatternProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Code size={14} className="shrink-0" />
      {totalFiles} file{totalFiles === 1 ? "" : "s"} changed
    </button>
  );
}

export function ReturnHeaderButton({ totalFiles, onOpen }: PatternProps) {
  return (
    <Button variant="outline" size="xs" onClick={onOpen} className="gap-1.5">
      <Code size={14} />
      <span>
        Changes
        <span className="ml-1 text-muted-foreground">{totalFiles}</span>
      </span>
    </Button>
  );
}

export function ReturnJumpChip({
  cards,
  messagesRef,
  onOpen,
}: {
  cards: ChangeCardAttachment[];
  messagesRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const cardEls = useRef<Element[]>([]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    const check = () => {
      const els = Array.from(container.querySelectorAll("[data-change-card]"));
      cardEls.current = els;
      if (els.length === 0) {
        setVisible(false);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const anyVisible = els.some((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > containerRect.top && r.top < containerRect.bottom;
      });
      setVisible(!anyVisible);
    };

    container.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(container);
    check();
    return () => {
      container.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, [messagesRef, cards]);

  if (!visible) return null;

  const totalFiles = cards.reduce((s, c) => s + c.files.length, 0);

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-10 -translate-x-1/2 anim-in">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        <ArrowUp size={12} />
        {totalFiles} file{totalFiles === 1 ? "" : "s"} changed
      </button>
    </div>
  );
}

export function ReturnScrollbarMarks({
  cards,
  messagesRef,
}: {
  cards: ChangeCardAttachment[];
  messagesRef: RefObject<HTMLDivElement | null>;
}) {
  const [marks, setMarks] = useState<number[]>([]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    const update = () => {
      const els = Array.from(container.querySelectorAll("[data-change-card]"));
      const scrollH = container.scrollHeight;
      if (scrollH === 0 || els.length === 0) {
        setMarks([]);
        return;
      }
      setMarks(
        els.map((el) => {
          const top =
            (el as HTMLElement).offsetTop -
            (container.firstElementChild as HTMLElement)?.offsetTop;
          return (top / scrollH) * 100;
        }),
      );
    };

    const ro = new ResizeObserver(update);
    ro.observe(container);
    update();
    return () => ro.disconnect();
  }, [messagesRef, cards]);

  if (marks.length === 0) return null;

  return (
    <>
      {marks.map((pct, i) => (
        <div
          key={i}
          className="pointer-events-none absolute right-0.5 z-10 h-1 w-1.5 rounded-full bg-accent"
          style={{ top: `${pct}%` }}
        />
      ))}
    </>
  );
}
