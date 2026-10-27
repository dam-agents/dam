// TEST_OVERVIEW: A profile whose provider the agent lacks connects it only after the same warning a not-connected model's pick gives — the agent can then use all of the provider's models — and a declined warning grants nothing (QA R8).
import type { ProfileWithUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { useProfileAttach } from "../../modules/profiles/hooks/use-profile-attach.js";

const state = vi.hoisted(() => ({
  confirm: vi.fn(async (..._args: unknown[]) => false),
  grant: vi.fn(async (_id: string) => true),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ showConfirm: state.confirm, navigateToSettings: vi.fn() }),
}));

vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: vi.fn(async () => {}) },
}));

vi.mock("../../trpc.js", () => ({
  trpc: { profiles: { list: { queryKey: () => ["profiles"] } } },
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useProviderConnections: () => ({
    owned: [{ id: "conn-bedrock", templateId: "bedrock" }],
  }),
  useGrantProvider: () => ({ grant: state.grant }),
}));

const profile: ProfileWithUsage = {
  id: "p1",
  name: "Opus high",
  harness: "claude-code",
  providerTemplate: "bedrock",
  model: "bedrock/opus",
  settings: { effort: "high" },
  newAgentDefault: false,
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: true },
};

let attach: ReturnType<typeof useProfileAttach>["attach"];
function Probe() {
  attach = useProfileAttach("agent-1").attach;
  return null;
}

/** TEST_SCENARIO: the warning names the provider and the profile's model; declined, nothing is granted; confirmed, the provider is granted and answered. */
it("warns before it connects the profile's provider", async () => {
  renderToStaticMarkup(createElement(Probe));
  expect(await attach(profile)).toBeNull();
  expect(state.confirm).toHaveBeenCalledWith(
    "This agent can then use every model AWS Bedrock offers, not only opus.",
    "Connect AWS Bedrock to this agent?",
    { confirmLabel: "Connect" },
  );
  expect(state.grant).not.toHaveBeenCalled();
  state.confirm.mockResolvedValueOnce(true);
  expect(await attach(profile)).toBe("conn-bedrock");
  expect(state.grant).toHaveBeenCalledWith("conn-bedrock");
});
