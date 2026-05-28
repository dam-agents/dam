import { Document as FileText, Folder } from "@carbon/icons-react";
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
      className="flex items-center gap-1.5 py-[5px] text-[12px]"
      style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
    >
      <span className="w-[13px] shrink-0" />
      {kind === "dir" ? (
        <Folder size={13} className="shrink-0" />
      ) : (
        <FileText size={13} className="shrink-0" />
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

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
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
      className="flex-1 h-6 px-1 py-0 text-[12px] font-mono bg-card border-primary"
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
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
