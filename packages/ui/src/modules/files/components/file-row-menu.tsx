import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

export type FileRowMenuAction =
  | "new-file"
  | "new-folder"
  | "upload-here"
  | "rename"
  | "delete";

interface Props {
  isDir: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: FileRowMenuAction) => void;
}

const VIEWPORT_MARGIN = 8;

export function FileRowMenu({ isDir, x, y, onClose, onAction }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // First render places the menu at raw click coords (hidden). After mount we
  // measure and clamp to viewport, then make it visible. This avoids a flash
  // of off-screen content and handles clicks near edges.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(x, viewportW - width - VIEWPORT_MARGIN),
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(y, viewportH - height - VIEWPORT_MARGIN),
    );
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Right-click handled by the row; don't race with it on close.
      if (e.button !== 0) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dispatch = (action: FileRowMenuAction) => {
    onClose();
    onAction(action);
  };

  // Portal to body so position:fixed positions to the viewport rather than
  // being trapped by ancestors with backdrop-filter (the right panel uses
  // backdrop-blur-xl, which creates a containing block for fixed children).
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 text-[12px]"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : { left: x, top: y, visibility: "hidden" }
      }
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isDir && (
        <>
          <MenuItem onSelect={() => dispatch("new-file")}>New file…</MenuItem>
          <MenuItem onSelect={() => dispatch("new-folder")}>
            New folder…
          </MenuItem>
          <MenuItem onSelect={() => dispatch("upload-here")}>
            Upload files here…
          </MenuItem>
        </>
      )}
      <MenuItem onSelect={() => dispatch("rename")}>Rename</MenuItem>
      <MenuItem danger onSelect={() => dispatch("delete")}>
        Delete
      </MenuItem>
    </div>,
    document.body,
  );
}

function MenuItem({
  children,
  danger,
  onSelect,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      role="menuitem"
      variant="ghost"
      tone={danger ? "danger" : undefined}
      size="sm"
      className="w-full justify-start"
      onClick={onSelect}
    >
      {children}
    </Button>
  );
}
