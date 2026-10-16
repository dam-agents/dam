import { hasA2uiBlock } from "api-server-api/chat-forms";
import { Document } from "@carbon/icons-react";

import { formatBytes } from "@/lib/format-size";

import { Markdown } from "../../../components/markdown.js";
import { A2uiAssistantText } from "../../a2ui/components/a2ui-assistant-text.js";
import { A2uiUserText } from "../../a2ui/components/a2ui-user-text.js";
import { useChatFormsEnabled } from "../../a2ui/hooks/use-chat-forms-enabled.js";
import { hasRendererBlocks } from "../../a2ui/lib/prompts.js";
import type { MessagePart, Role } from "../../../types.js";
import { PermissionVerdictLine } from "./permission-prompt.js";
import { ThoughtBlock } from "./thought-block.js";
import { ToolChip } from "./tool-chip.js";

interface Props {
  part: MessagePart;
  role: Role;
  streaming: boolean;
  isLast: boolean;
  partIndex: number;
  messageId: string;
  interactive: boolean;
  onFileClick: (path: string) => void;
}

export function ChatMessagePart({
  part,
  role,
  streaming,
  isLast,
  partIndex,
  messageId,
  interactive,
  onFileClick,
}: Props) {
  const formsEnabled = useChatFormsEnabled();

  switch (part.kind) {
    case "text":
      if (role === "assistant") {
        if (formsEnabled && hasA2uiBlock(part.text)) {
          return (
            <A2uiAssistantText
              text={part.text}
              partKey={`${messageId}:${partIndex}`}
              interactive={interactive}
              onFileClick={onFileClick}
            />
          );
        }
        return <Markdown onFileClick={onFileClick}>{part.text}</Markdown>;
      }
      if (formsEnabled && hasRendererBlocks(part.text)) {
        return <A2uiUserText text={part.text} />;
      }
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
