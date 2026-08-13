import { Document } from "@carbon/icons-react";

import { formatBytes } from "@/lib/format-size";

import { Markdown } from "../../../components/markdown.js";
import type { MessagePart, Role } from "../../../types.js";
import { PermissionVerdictLine } from "./permission-prompt.js";
import { ThoughtBlock } from "./thought-block.js";
import { ToolChip } from "./tool-chip.js";

interface Props {
  part: MessagePart;
  role: Role;
  streaming: boolean;
  isLast: boolean;
  onFileClick: (path: string) => void;
}

export function ChatMessagePart({
  part,
  role,
  streaming,
  isLast,
  onFileClick,
}: Props) {
  switch (part.kind) {
    case "text":
      if (role === "assistant")
        return <Markdown onFileClick={onFileClick}>{part.text}</Markdown>;
      return (
        <span className="whitespace-pre-wrap break-words">
          {part.text}
          {streaming && isLast && (
            <span className="inline-block w-[7px] h-4 bg-accent ml-0.5 align-text-bottom anim-blink rounded-sm" />
          )}
        </span>
      );
    case "thought":
      return <ThoughtBlock text={part.text} streaming={streaming} />;
    case "image":
      return (
        <img
          src={`data:${part.mimeType};base64,${part.data}`}
          alt="image"
          className="max-w-[400px] max-h-[400px] rounded-lg border border-border object-contain"
        />
      );
    case "verdict":
      return <PermissionVerdictLine verdict={part} />;
    case "file":
      return (
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <Document size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">{part.name}</span>
          {part.size !== undefined && (
            <span className="text-[10px] text-muted-foreground">
              {formatBytes(part.size)}
            </span>
          )}
        </div>
      );
    default:
      return <ToolChip chip={part} />;
  }
}
