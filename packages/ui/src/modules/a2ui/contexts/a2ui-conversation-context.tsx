import type {
  A2uiConversation,
  FunctionResponse,
} from "api-server-api/chat-forms";
import { createContext, useContext } from "react";

export interface A2uiConversationState {
  conversation: A2uiConversation;
  sessionKey: string;
  liveMessageId: string | null;
  withRendererMetadata: (text: string) => string;
  answeredCalls: ReadonlySet<string>;
  pendingResponses: readonly FunctionResponse[];
  autoRepliesPaused: boolean;
}

const A2uiConversationContext = createContext<A2uiConversationState | null>(
  null,
);

export const A2uiConversationProvider = A2uiConversationContext.Provider;

export function useA2uiConversationState(): A2uiConversationState | null {
  return useContext(A2uiConversationContext);
}
