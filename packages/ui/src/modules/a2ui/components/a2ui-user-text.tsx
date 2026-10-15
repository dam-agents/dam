import { useMemo } from "react";

import { parseUserText, type RendererMessage } from "../lib/prompts.js";
import { A2uiActionSummary } from "./a2ui-action-summary.js";

function RendererMessageSummary({ message }: { message: RendererMessage }) {
  if ("action" in message) return <A2uiActionSummary action={message.action} />;
  if ("error" in message)
    return (
      <span className="text-xs text-muted-foreground">
        Sent a UI error to the agent · {message.error.code}
      </span>
    );
  return (
    <span className="text-xs text-muted-foreground">
      Sent a function result to the agent ·{" "}
      {message.rendererFunctionResponse.functionCallId}
    </span>
  );
}

interface Props {
  text: string;
}

export function A2uiUserText({ text }: Props) {
  const parsed = useMemo(() => parseUserText(text), [text]);
  return (
    <div className="flex flex-col gap-2">
      {parsed.text && (
        <span className="whitespace-pre-wrap break-words">{parsed.text}</span>
      )}
      {parsed.messages.map((message, index) => (
        <RendererMessageSummary key={index} message={message} />
      ))}
      {parsed.dataModelSurfaces.length > 0 && (
        <span className="text-2xs text-muted-foreground">
          Form data attached: {parsed.dataModelSurfaces.join(", ")}
        </span>
      )}
    </div>
  );
}
