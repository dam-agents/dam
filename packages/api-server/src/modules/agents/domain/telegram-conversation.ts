/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells a one-to-one Telegram chat from a group by
 * its conversation id (`telegram:<chatId>[:<topicId>]` or
 * `telegram:biz:<connectionId>:<chatId>`). Telegram gives groups and channels
 * negative chat ids and private chats the user's positive id; business
 * connections are always one-to-one. The UI warns about connections shared
 * with a chat only when other people are in it.
 */
export function isTelegramDirectConversation(conversationId: string): boolean {
  const [, first] = conversationId.split(":");
  if (first === "biz") return true;
  return first !== undefined && first !== "" && !first.startsWith("-");
}
