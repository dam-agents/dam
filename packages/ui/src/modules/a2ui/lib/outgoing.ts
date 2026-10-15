import { chatFormCapabilities } from "api-server-api";
import type { A2uiConversation } from "api-server-api/chat-forms";

import { a2uiEditKey } from "../store.js";
import { withDataModels } from "./prompts.js";

export function withRendererMetadata(
  text: string,
  conversation: A2uiConversation,
  sessionKey: string,
  edits: Readonly<Record<string, unknown>>,
): string {
  const models: Record<string, unknown> = {};
  for (const surface of conversation.surfaces.values()) {
    if (!surface.sendDataModel || surface.deleted) continue;
    models[surface.id] =
      edits[a2uiEditKey(sessionKey, surface)] ?? surface.dataModel;
  }
  return withDataModels(`${text}\n\n${chatFormCapabilities()}`, models);
}
