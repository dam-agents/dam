import { describe, it, expect, afterEach } from "vitest";
import {
  createBoltSlackGateway,
  sendsBotToken,
} from "../../modules/channels/infrastructure/bolt-slack-gateway.js";

const BOT_TOKEN = "xoxb-secret";
const PRIVATE_URL = "https://files.slack.com/files-pri/T1-F1/shot.png";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Hop = { url: string; authorization: string | null };

/** Stub fetch with a fixed redirect chain; records the header sent per hop. */
function stubFetch(
  route: (url: string) => { status: number; location?: string; body?: Buffer },
): Hop[] {
  const hops: Hop[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    hops.push({ url, authorization: headers.Authorization ?? null });
    const { status, location, body } = route(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name: string) =>
          name === "location" ? (location ?? null) : null,
      },
      arrayBuffer: async () => {
        const b = body ?? Buffer.alloc(0);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return hops;
}

function gateway() {
  return createBoltSlackGateway({
    botToken: BOT_TOKEN,
    appToken: "xapp-1",
    commandName: "dam",
  });
}

describe("sendsBotToken", () => {
  it("carries the token to Slack's own https hosts only", () => {
    expect(sendsBotToken("https://files.slack.com/files-pri/x")).toBe(true);
    expect(sendsBotToken("https://slack.com/files-pri/x")).toBe(true);
    expect(sendsBotToken("https://evil.example.com/files-pri/x")).toBe(false);
    // A look-alike host that merely ends with the string, and a plaintext hop.
    expect(sendsBotToken("https://notslack.com/x")).toBe(false);
    expect(sendsBotToken("http://files.slack.com/x")).toBe(false);
    expect(sendsBotToken("not a url")).toBe(false);
  });
});

describe("slack file download", () => {
  it("re-attaches the bot token across a redirect within Slack", async () => {
    // fetch() drops Authorization on a cross-origin redirect, and Slack answers
    // an unauthenticated file request with a 200 sign-in page — so following
    // hops by hand is what keeps the bytes coming back (#3008).
    const signed = "https://files-edge.slack.com/signed/shot.png";
    const hops = stubFetch((url) =>
      url === PRIVATE_URL
        ? { status: 302, location: signed }
        : { status: 200, body: PNG },
    );

    const bytes = Buffer.from(await gateway().downloadFile(PRIVATE_URL));

    expect(bytes.equals(PNG)).toBe(true);
    expect(hops.map((h) => h.authorization)).toEqual([
      `Bearer ${BOT_TOKEN}`,
      `Bearer ${BOT_TOKEN}`,
    ]);
  });

  it("withholds the token when a redirect leaves Slack", async () => {
    const hops = stubFetch((url) =>
      url === PRIVATE_URL
        ? { status: 302, location: "https://cdn.example.com/signed/shot.png" }
        : { status: 200, body: PNG },
    );

    await gateway().downloadFile(PRIVATE_URL);

    expect(hops[1]).toMatchObject({
      url: "https://cdn.example.com/signed/shot.png",
      authorization: null,
    });
  });

  it("resolves a relative redirect target", async () => {
    const hops = stubFetch((url) =>
      url === PRIVATE_URL
        ? { status: 302, location: "/files-pri/T1-F1/download/shot.png" }
        : { status: 200, body: PNG },
    );

    await gateway().downloadFile(PRIVATE_URL);

    expect(hops[1]!.url).toBe(
      "https://files.slack.com/files-pri/T1-F1/download/shot.png",
    );
  });

  it("throws on an HTTP error instead of returning an error body", async () => {
    stubFetch(() => ({ status: 403, body: Buffer.from("nope") }));

    await expect(gateway().downloadFile(PRIVATE_URL)).rejects.toThrow(
      "HTTP 403",
    );
  });

  it("gives up on a redirect loop", async () => {
    stubFetch(() => ({ status: 302, location: PRIVATE_URL }));

    await expect(gateway().downloadFile(PRIVATE_URL)).rejects.toThrow(
      "too many redirects",
    );
  });

  it("throws when a redirect carries no target", async () => {
    stubFetch(() => ({ status: 302 }));

    await expect(gateway().downloadFile(PRIVATE_URL)).rejects.toThrow(
      "no redirect target",
    );
  });
});
