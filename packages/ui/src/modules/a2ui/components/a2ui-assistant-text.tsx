import { splitA2uiBlocks } from "api-server-api/chat-forms";
import { useMemo } from "react";

import { Markdown } from "@/components/markdown";

import { blockKey } from "../lib/collect-blocks.js";
import { A2uiBlock } from "./a2ui-block.js";

type View =
  | { kind: "markdown"; text: string }
  | { kind: "a2ui"; key: string; source: string; closed: boolean };

function views(text: string, partKey: string): View[] {
  let blockIndex = 0;
  return splitA2uiBlocks(text).map((segment) => {
    if (segment.kind === "markdown") return segment;
    const key = blockKey(partKey, blockIndex);
    blockIndex += 1;
    return { ...segment, key };
  });
}

interface ViewProps {
  view: View;
  interactive: boolean;
  onFileClick?: (path: string) => void;
}

function SegmentView({ view, interactive, onFileClick }: ViewProps) {
  if (view.kind === "markdown")
    return <Markdown onFileClick={onFileClick}>{view.text}</Markdown>;
  return (
    <A2uiBlock
      blockKey={view.key}
      source={view.source}
      closed={view.closed}
      interactive={interactive}
    />
  );
}

interface Props {
  text: string;
  partKey: string;
  interactive: boolean;
  onFileClick?: (path: string) => void;
}

export function A2uiAssistantText({
  text,
  partKey,
  interactive,
  onFileClick,
}: Props) {
  const segments = useMemo(() => views(text, partKey), [text, partKey]);
  return (
    <div className="flex flex-col gap-4">
      {segments.map((view, index) => (
        <SegmentView
          key={view.kind === "a2ui" ? view.key : index}
          view={view}
          interactive={interactive}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
