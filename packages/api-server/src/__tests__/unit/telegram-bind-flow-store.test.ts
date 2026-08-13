import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { createTelegramBindFlowStore } from "../../modules/channels/infrastructure/telegram-flows.js";

const BIND = {
  conversationId: "chat-42",
  telegramUserId: "tg-7",
  keycloakSub: "kc|owner-1",
  chatTitle: "Team chat",
};

describe("telegram bind-flow store", () => {
  it("create → peek returns the record without consuming it", async () => {
    const store = createTelegramBindFlowStore({
      now: () => 1_000,
      store: createMemoryTtlStore(600_000, () => 1_000),
    });
    const id = await store.create(BIND);
    expect(await store.peek(id)).toMatchObject(BIND);
    expect(await store.peek(id)).toMatchObject(BIND);
  });

  it("consume removes the record", async () => {
    const store = createTelegramBindFlowStore({
      now: () => 1_000,
      store: createMemoryTtlStore(600_000, () => 1_000),
    });
    const id = await store.create(BIND);
    await store.consume(id);
    expect(await store.peek(id)).toBe(null);
  });

  it("expires records past the TTL", async () => {
    let clock = 1_000;
    const store = createTelegramBindFlowStore({
      now: () => clock,
      store: createMemoryTtlStore(60_000, () => clock),
    });
    const id = await store.create(BIND);
    clock += 60_001;
    expect(await store.peek(id)).toBe(null);
    clock = 1_000;
    expect(await store.peek(id)).toBe(null);
  });

  it("unknown flow ids read as null", async () => {
    const store = createTelegramBindFlowStore({
      store: createMemoryTtlStore(600_000),
    });
    expect(await store.peek("nope")).toBe(null);
  });
});
