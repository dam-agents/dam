import "@git-diff-view/react/styles/diff-view-pure.css";

import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { FileDiff } from "agent-runtime-api";
import { useState } from "react";

import { useStore } from "../../../store.js";
import { isDarkTheme } from "../../platform/store/theme.js";
import {
  type DiffLayout,
  fileDiffBody,
  fileDiffData,
} from "../lib/diff-layout.js";
import { DiffStatText } from "./diff-stat-text.js";
import { FileStatusMark } from "./file-status-mark.js";

interface Props {
  file: FileDiff;
  layout: DiffLayout;
  anchor: string;
}

export function FileDiffCard({ file, layout, anchor }: Props) {
  const theme = useStore((s) => s.theme);
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const body = fileDiffBody(file, expandedByUser);
  const expandable = body === "shown" || body === "collapsed";
  const Chevron = body === "shown" ? ChevronDown : ChevronRight;

  return (
    <section
      id={anchor}
      className="scroll-mt-2 overflow-hidden rounded-md border border-border [&_[data-component=git-diff-view]_.sticky]:static!"
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5">
        <button
          type="button"
          disabled={!expandable}
          aria-expanded={body === "shown"}
          aria-label={body === "shown" ? "Collapse file" : "Expand file"}
          onClick={() => setExpandedByUser(body !== "shown")}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {expandable && (
            <Chevron size={14} className="shrink-0 text-muted-foreground" />
          )}
          <FileStatusMark file={file} />
          <span
            className="truncate font-mono text-xs text-foreground"
            title={file.path}
          >
            {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
        </button>
        <DiffStatText stat={file} className="shrink-0" />
      </header>
      {body === "shown" && file.patch !== null ? (
        <DiffView
          data={fileDiffData(file)}
          diffViewMode={
            layout === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified
          }
          diffViewTheme={isDarkTheme(theme) ? "dark" : "light"}
          diffViewHighlight
          diffViewFontSize={12}
        />
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {body === "binary"
            ? "Binary file not shown."
            : body === "too-large"
              ? "This diff is too large to show."
              : "Large diff collapsed. Expand it to show."}
        </p>
      )}
    </section>
  );
}
