import type { FunctionCallOutcome } from "api-server-api/chat-forms";
import { A2UI_VERSION } from "api-server-api/chat-forms";

import { Callout } from "@/components/ui/callout";

import { useA2uiConversationState } from "../contexts/a2ui-conversation-context.js";
import { MAX_AUTOMATIC_REPLIES } from "../lib/function-replies.js";
import { formatRendererMessage } from "../lib/prompts.js";
import { A2uiSendButton } from "./a2ui-send-button.js";

function ReplyStatus({ outcome }: { outcome: FunctionCallOutcome }) {
  const state = useA2uiConversationState();
  const { functionCallId } = outcome.response;
  if (state?.answeredCalls.has(functionCallId))
    return (
      <p className="text-xs text-muted-foreground">
        The result was sent to the agent.
      </p>
    );
  const pending =
    state?.pendingResponses.some(
      (response) => response.functionCallId === functionCallId,
    ) ?? false;
  if (pending && !state?.autoRepliesPaused)
    return (
      <p className="text-xs text-muted-foreground">
        Sending the result to the agent…
      </p>
    );
  return (
    <>
      {pending && (
        <p className="text-xs text-muted-foreground">
          Automatic replies paused after {MAX_AUTOMATIC_REPLIES} in a row.
        </p>
      )}
      <A2uiSendButton
        prompt={formatRendererMessage({
          version: A2UI_VERSION,
          rendererFunctionResponse: outcome.response,
        })}
        label="Send the result to the agent"
      />
    </>
  );
}

interface Props {
  outcome: FunctionCallOutcome;
}

export function A2uiFunctionCallNotice({ outcome }: Props) {
  const { name, response } = outcome;
  return (
    <Callout
      tone="muted"
      size="sm"
      className="not-prose flex flex-col gap-2 text-sm"
    >
      <p className="text-foreground">
        The agent asked this app to run <code>{name}</code>.{" "}
        {response.error
          ? `It was refused: ${response.error.message}`
          : "It ran."}
      </p>
      <ReplyStatus outcome={outcome} />
    </Callout>
  );
}
