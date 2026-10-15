import { useCallback, useMemo } from "react";

import { useStore } from "../../../store.js";
import {
  A2uiConversationProvider,
  useA2uiConversationState,
} from "../contexts/a2ui-conversation-context.js";
import { useChatFormsEnabled } from "../hooks/use-chat-forms-enabled.js";
import { buildConversation } from "../lib/build-conversation.js";
import { withRendererMetadata as attachMetadata } from "../lib/outgoing.js";
import { A2uiBlockView } from "./a2ui-block-view.js";
import { A2uiFormsOff } from "./a2ui-forms-off.js";

const STANDALONE_MESSAGE = "standalone";
const NOTHING_ANSWERED: ReadonlySet<string> = new Set();

interface Props {
  blockKey: string;
  source: string;
  closed: boolean;
  interactive: boolean;
}

function A2uiStandaloneBlock({ blockKey, source, closed, interactive }: Props) {
  const conversation = useMemo(
    () =>
      buildConversation([
        { key: blockKey, messageId: STANDALONE_MESSAGE, source, closed },
      ]),
    [blockKey, source, closed],
  );
  const sessionKey = `standalone:${blockKey}`;
  const withRendererMetadata = useCallback(
    (text: string) =>
      attachMetadata(
        text,
        conversation,
        sessionKey,
        useStore.getState().a2uiEdits,
      ),
    [conversation, sessionKey],
  );
  const state = useMemo(
    () => ({
      conversation,
      sessionKey,
      liveMessageId: interactive && closed ? STANDALONE_MESSAGE : null,
      withRendererMetadata,
      answeredCalls: NOTHING_ANSWERED,
      pendingResponses: [],
      autoRepliesPaused: true,
    }),
    [conversation, sessionKey, interactive, closed, withRendererMetadata],
  );
  return (
    <A2uiConversationProvider value={state}>
      <A2uiBlockView blockKey={blockKey} source={source} />
    </A2uiConversationProvider>
  );
}

export function A2uiBlock(props: Props) {
  const conversation = useA2uiConversationState();
  const enabled = useChatFormsEnabled();
  if (!enabled) return <A2uiFormsOff source={props.source} />;
  if (conversation?.conversation.blocks.has(props.blockKey))
    return <A2uiBlockView blockKey={props.blockKey} source={props.source} />;
  return <A2uiStandaloneBlock {...props} />;
}
