import { describe, it, expect } from "vitest";
import { createTelegramBindFlowStore } from "../../modules/channels/infrastructure/telegram-flows.js";

const BIND = {
  conversationId: "chat-42",
  telegramUserId: "tg-7",
  keycloakSub: "kc|owner-1",
  chatTitle: "Team chat",
};

describe("telegram bind-flow store", () => {
  it("create → peek returns the record without consuming it", () => {
    const store = createTelegramBindFlowStore({ now: () => 1_000 });
    const id = store.create(BIND);
    expect(store.peek(id)).toMatchObject(BIND);
    expect(store.peek(id)).toMatchObject(BIND);
  });

  it("consume removes the record", () => {
    const store = createTelegramBindFlowStore({ now: () => 1_000 });
    const id = store.create(BIND);
    store.consume(id);
    expect(store.peek(id)).toBe(null);
  });

  it("expires records past the TTL", () => {
    let clock = 1_000;
    const store = createTelegramBindFlowStore({
      now: () => clock,
      ttlMs: 60_000,
    });
    const id = store.create(BIND);
    clock += 60_001;
    expect(store.peek(id)).toBe(null);
    // Expired entries are deleted on read, not resurrected later.
    clock = 1_000;
    expect(store.peek(id)).toBe(null);
  });

  it("unknown flow ids read as null", () => {
    const store = createTelegramBindFlowStore();
    expect(store.peek("nope")).toBe(null);
  });
});
