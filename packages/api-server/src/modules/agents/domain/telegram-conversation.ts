/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads a Telegram conversation id
 * (`telegram:<chatId>[:<topicId>]` or `telegram:biz:<connectionId>:<chatId>`).
 * It tells a one-to-one chat from a group: Telegram gives groups and channels
 * negative chat ids and private chats the user's positive id, and business
 * connections are always one-to-one. The UI warns about connections shared
 * with a chat only when other people are in it. It also names the chat a
 * forum topic belongs to, because a binding covers its whole chat.
 */
export function isTelegramDirectConversation(conversationId: string): boolean {
  const [, first] = conversationId.split(":");
  if (first === "biz") return true;
  return first !== undefined && first !== "" && !first.startsWith("-");
}

export function isTelegramPrivateChat(conversationId: string): boolean {
  return (
    isTelegramDirectConversation(conversationId) &&
    conversationId.split(":")[1] !== "biz"
  );
}

export function telegramChatOf(conversationId: string): string {
  const [surface, chatId, topicId] = conversationId.split(":");
  return chatId === "biz" || topicId === undefined
    ? conversationId
    : `${surface}:${chatId}`;
}
