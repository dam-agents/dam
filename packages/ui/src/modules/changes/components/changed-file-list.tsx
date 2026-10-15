import type { FileDiff } from "agent-runtime-api";
import type { RefObject } from "react";

import { fileDiffAnchor, scrollTopToShow } from "../lib/diff-layout.js";
import { DiffStatText } from "./diff-stat-text.js";
import { FileStatusMark } from "./file-status-mark.js";

interface Props {
  files: readonly FileDiff[];
  anchorPrefix: string;
  scrollRef: RefObject<HTMLElement | null>;
}

function jumpTo(container: HTMLElement | null, anchor: string): void {
  const target = document.getElementById(anchor);
  if (!container || !target) return;
  container.scrollTo({
    top: scrollTopToShow(
      {
        top: container.getBoundingClientRect().top,
        scrollTop: container.scrollTop,
      },
      {
        top: target.getBoundingClientRect().top,
        scrollMarginTop: parseFloat(getComputedStyle(target).scrollMarginTop),
      },
    ),
  });
}

export function ChangedFileList({ files, anchorPrefix, scrollRef }: Props) {
  return (
    <ul aria-label="Changed files" className="flex flex-col py-1">
      {files.map((file, index) => (
        <li key={file.path}>
          <button
            type="button"
            onClick={() =>
              jumpTo(scrollRef.current, fileDiffAnchor(anchorPrefix, index))
            }
            className="flex w-full min-w-0 items-center gap-2 px-4 py-1 text-left hover:bg-muted"
          >
            <FileStatusMark file={file} />
            <span
              className="truncate font-mono text-xs text-foreground"
              title={file.path}
            >
              {file.path}
            </span>
            <DiffStatText stat={file} className="ml-auto shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  );
}
