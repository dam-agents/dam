import { at, type PlatformOutput } from "../platform";
import { ago, IDS, NOW, whenPopulated } from "../scenario";

type ApiKey = PlatformOutput<"apiKeys.list">[number];

const API_KEYS: ApiKey[] = [
  {
    id: "key-7f3a9c21-4e6b-4d2a-9b1c-3e5f7a9d0b12",
    name: "GitHub Actions — checkout-service",
    scopes: ["agents:read", "agents:operate"],
    agentIds: [IDS.codingAgent],
    expiresAt: new Date(NOW + 60 * 24 * 60 * 60_000).toISOString(),
    createdAt: ago(60 * 24 * 34),
    lastUsedAt: ago(42),
  },
  {
    id: "key-2b8e4d10-1a3c-4f5e-8d7b-6c9a0e2f4b31",
    name: "Local CLI",
    scopes: ["agents:read", "agents:operate", "agents:manage"],
    agentIds: "*",
    expiresAt: null,
    createdAt: ago(60 * 24 * 71),
    lastUsedAt: ago(60 * 26),
  },
  {
    id: "key-91c0e6f4-7d2b-4a8e-b5c3-0f1e2d3c4b56",
    name: "Laptop satellite",
    scopes: ["satellites:serve"],
    agentIds: "*",
    expiresAt: null,
    createdAt: ago(60 * 24 * 9),
    lastUsedAt: ago(60 * 3),
  },
  {
    id: "key-5d4a7b83-9e0f-4c1d-a2b3-8f7e6d5c4a09",
    name: "Nightly data export",
    scopes: ["agents:read", "credentials:read"],
    agentIds: [IDS.hibernatedAgent],
    expiresAt: ago(60 * 24 * 3),
    createdAt: ago(60 * 24 * 93),
    lastUsedAt: ago(60 * 24 * 4),
  },
];

/** Must match the `/api/terms` document `.storybook/main.ts` serves. */
const TERMS = { version: "storybook", hash: "storybook" };

export const settingsEntries = [
  at("apiKeys.list", () => whenPopulated(API_KEYS, [])),

  at("terms.current", () => TERMS),
  at("terms.latestAcceptance", () => ({
    ...TERMS,
    acceptedAt: ago(60 * 24 * 21),
  })),

  // The bind pages open from a `/bind` link in the chat, which carries
  // `?flow=<id>`; these answer once a story supplies one.
  at("agents.peekTelegramBindFlow", () => ({ chatTitle: "Platform on-call" })),
  at("agents.peekSlackBindFlow", () => ({
    slackChannelId: "C07PLTFRM01",
    name: "platform-alerts",
  })),
];
