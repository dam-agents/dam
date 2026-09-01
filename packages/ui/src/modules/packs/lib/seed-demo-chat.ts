import { useStore } from "../../../store.js";
import { getDemoFixtures } from "../data/pack-demo-fixtures.js";
import type { Pack } from "../data/packs.js";

export function seedDemoChat(pack: Pack): void {
  const fixtures = getDemoFixtures(pack.id);
  if (!fixtures || fixtures.seedMessages.length === 0) return;

  const store = useStore.getState();
  store.setSessionId(`demo-session-${pack.id}`);
  store.setMessages(fixtures.seedMessages);
}
