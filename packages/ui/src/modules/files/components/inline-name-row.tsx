import { Document, Folder } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

import type { FileEntryKind } from "../hooks/use-file-mutations.js";

interface Props {
  kind: FileEntryKind;
  depth: number;
  initial?: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export function InlineNameRow({
  kind,
  depth,
  initial = "",
  placeholder,
  onCommit,
  onCancel,
}: Props) {
  return (
    <div
      className="flex items-center gap-1.5 py-[5px] text-xs"
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
    >
      <span className="w-4 shrink-0" />
      {kind === "dir" ? (
        <Folder size={16} className="shrink-0" />
      ) : (
        <Document size={16} className="shrink-0" />
      )}
      <InlineNameInput
        initial={initial}
        placeholder={placeholder}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

interface InputProps {
  initial: string;
  placeholder?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

function InlineNameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: InputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  // Guard against double-firing commit from blur + Enter; both paths race.
  const committedRef = useRef(false);
  // True while the focus grab below is running; blurs during that window are
  // the menu's focus trap yanking, not user intent — don't commit on them.
  const grabbingRef = useRef(true);

  // The row is usually spawned from a menu whose focus trap stays alive
  // through its exit animation and which refocuses its trigger at the end —
  // a single focus() loses. Re-assert briefly, then behave normally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let ticks = 0;
    const tick = () => {
      if (document.activeElement !== el) {
        el.focus();
        el.select();
      }
      if (++ticks < 30) raf = requestAnimationFrame(tick);
      else grabbingRef.current = false;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial) onCancel();
    else onCommit(trimmed);
  };

  return (
    <Input
      ref={ref}
      className="flex-1 h-[26px] px-1 py-0 text-xs bg-card border-primary"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!grabbingRef.current) commit();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
