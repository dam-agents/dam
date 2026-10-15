import {
  type A2uiConversation,
  type BlockInput,
  buildConversation as build,
} from "api-server-api/chat-forms";

import { callFunction } from "./functions/evaluate.js";

export function buildConversation(
  blocks: readonly BlockInput[],
): A2uiConversation {
  return build(blocks, {
    callFunction: (call) =>
      callFunction(call, {
        model: {},
        scope: "",
        indexes: [],
        catalogId: call.catalogId,
        userActivation: false,
      }),
  });
}
