// @vitest-environment happy-dom
// TEST_OVERVIEW: an OAuth sign-in in a popup finishes even when the authorization server cuts the popup off from the page that opened it. A server that sends Cross-Origin-Opener-Policy: same-origin leaves the opener seeing the popup as closed and the callback page with no window.opener, so the result also comes over a BroadcastChannel on the app's origin and is taken for the connection being authorized. A popup that reads as closed does not cancel the flow; Cancel does, and removes the half-made connection. The button that refocuses the popup opens a new one when the old one is out of reach. While the form waits, it says so in a status line with the time left, warns to close a sign-in window still open before reopening, and names Cancel as discarding the connection.
import type { ConnectionView } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  toasts: [] as { kind: string; message: string }[],
  created: [] as string[],
  connection: null as { id: string; status: string } | null,
  get: vi.fn(),
  del: vi.fn(),
  startOAuth: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  emitToast: (t: { kind: string; message: string }) => fake.toasts.push(t),
}));
vi.mock("../../api.js", () => ({
  api: {
    connections: {
      get: { query: fake.get },
      delete: { mutate: fake.del },
      startOAuth: { mutate: fake.startOAuth },
    },
  },
}));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: async () => {}, getQueryData: () => [] },
}));
vi.mock("../../trpc.js", () => ({
  trpc: { connections: { list: { queryKey: () => ["connections"] } } },
}));
vi.mock("../../modules/connections/api/mutations.js", () => {
  const idle = { isPending: false };
  return {
    useCreateConnection: () => ({
      ...idle,
      mutateAsync: async () => ({ id: "conn-1" }),
    }),
    useDiscoverMcp: () => ({
      ...idle,
      mutateAsync: async () => ({ auth: "oauth" }),
    }),
    useProbeClusterCa: () => ({ ...idle, mutateAsync: async () => ({}) }),
  };
});

const { useTemplateCreateSubmit } =
  await import("../../modules/connections/hooks/use-template-create-submit.js");
const { useReauthenticateConnection } =
  await import("../../modules/connections/hooks/use-reauthenticate-connection.js");
const { OAuthPopupWait } =
  await import("../../modules/connections/components/oauth-popup-wait.js");

interface FakePopup {
  closed: boolean;
  location: { href: string };
  close: () => void;
  focus: () => void;
}

let popups: FakePopup[];
let root: Root;
let host: HTMLElement;
let submitHook: ReturnType<typeof useTemplateCreateSubmit>;
let reauthHook: ReturnType<typeof useReauthenticateConnection>;

const severed = (): FakePopup => ({
  closed: true,
  location: { href: "" },
  close: () => {},
  focus: vi.fn(),
});

function Harness() {
  submitHook = useTemplateCreateSubmit({
    template: {
      id: "mcp-oauth",
      name: "Custom MCP server (OAuth)",
      category: "other",
      isCustom: true,
      authKind: "oauth",
      inputs: [],
    } as never,
    popupOAuth: true,
    onCreated: (id) => fake.created.push(id),
  });
  reauthHook = useReauthenticateConnection();
  return null;
}

function broadcast(data: Record<string, unknown>) {
  const channel = new BroadcastChannel("platform-oauth");
  channel.postMessage({ source: "platform-oauth", ...data });
  channel.close();
}

async function flush(ms = 50) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  popups = [];
  fake.toasts.length = 0;
  fake.created.length = 0;
  fake.connection = { id: "conn-1", status: "pending" };
  fake.get.mockReset().mockImplementation(async () => fake.connection);
  fake.del.mockReset().mockResolvedValue(undefined);
  fake.startOAuth
    .mockReset()
    .mockResolvedValue({ authUrl: "https://as.example/authorize" });
  vi.spyOn(window, "open").mockImplementation(() => {
    const p = { ...severed(), closed: false };
    popups.push(p);
    return p as unknown as Window;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function submitAndSever() {
  await act(async () => {
    await submitHook.submit({
      authKind: "oauth",
      url: "https://mcp.example.com/mcp",
    } as never);
  });
  expect(popups[0].location.href).toBe("https://as.example/authorize");
  popups[0].closed = true;
  await flush(1500);
}

// TEST_SCENARIO: the reported bug. The popup reads as closed the moment the authorization server's COOP header severs it, and the old code cancelled the flow and deleted the connection. Now the flow waits, and the callback's broadcast for this connection completes it.
it("a severed popup's broadcast result creates the connection", async () => {
  await submitAndSever();
  expect(submitHook.awaitingPopup).toBe(true);
  expect(submitHook.popupDeadlineAt).toBeGreaterThan(Date.now());
  expect(fake.del).not.toHaveBeenCalled();
  expect(fake.toasts).toEqual([]);

  fake.connection = { id: "conn-1", status: "active" };
  broadcast({ oauth: "success", connection: "conn-1" });
  await flush();

  expect(fake.created).toEqual(["conn-1"]);
  expect(submitHook.awaitingPopup).toBe(false);
  expect(fake.del).not.toHaveBeenCalled();
});

// TEST_SCENARIO: another tab of the same user may finish its own sign-in while this one waits; a broadcast for another connection is not this flow's result.
it("a broadcast for another connection is ignored", async () => {
  await submitAndSever();
  broadcast({ oauth: "success", connection: "conn-other" });
  await flush();
  expect(fake.created).toEqual([]);
  expect(submitHook.awaitingPopup).toBe(true);
});

// TEST_SCENARIO: a provider error at the callback reaches the form through the broadcast too, and the half-made connection is removed.
it("a broadcast error removes the pending connection and says why", async () => {
  await submitAndSever();
  broadcast({ oauth: "error", message: "access_denied", connection: "conn-1" });
  await flush();
  expect(fake.del).toHaveBeenCalledWith({ id: "conn-1" });
  expect(fake.toasts).toEqual([{ kind: "error", message: "access_denied" }]);
});

// TEST_SCENARIO: with no result coming, the user leaves through Cancel: the flow ends quietly and the connection that never got a token is deleted.
it("Cancel ends the wait and removes the pending connection", async () => {
  await submitAndSever();
  await act(async () => {
    submitHook.cancelAuthorization();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(submitHook.awaitingPopup).toBe(false);
  expect(fake.del).toHaveBeenCalledWith({ id: "conn-1" });
  expect(fake.toasts).toEqual([]);
});

// TEST_SCENARIO: the user really closed the popup before signing in. "Reopen" cannot focus a window the page no longer reaches, so it opens a new popup on a new sign-in for the same connection.
it("reopen starts a new popup when the old one is out of reach", async () => {
  await submitAndSever();
  await act(async () => {
    submitHook.refocusPopup();
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(popups).toHaveLength(2);
  expect(fake.startOAuth).toHaveBeenLastCalledWith({
    connectionId: "conn-1",
    popup: true,
  });
  expect(popups[1].location.href).toBe("https://as.example/authorize");
});

// TEST_SCENARIO: re-authenticating a connection goes through the same popup, so a severed popup there completes by broadcast as well.
it("re-authenticate completes by broadcast", async () => {
  const conn = {
    id: "conn-9",
    connectedAt: "2026-11-01T00:00:00Z",
  } as ConnectionView;
  await act(async () => {
    await reauthHook.reauthenticate(conn);
  });
  popups[0].closed = true;
  await flush(1500);
  expect(fake.toasts).toEqual([]);

  broadcast({ oauth: "success", connection: "conn-9" });
  await flush();
  expect(fake.toasts).toEqual([
    { kind: "success", message: "Connection re-authenticated." },
  ]);
});

// TEST_SCENARIO: the wait is a status, not a button: the person sees that the sign-in still runs and how long it may take, is told to close a window still open before reopening, and sees that Cancel discards the connection. Only the static sentence is a live region, so a screen reader does not read the clock every second.
it("the wait panel shows the time left and what Cancel does", async () => {
  const onReopen = vi.fn();
  const onDiscard = vi.fn();
  act(() =>
    root.render(
      createElement(OAuthPopupWait, {
        deadlineAt: Date.now() + 10 * 60 * 1000,
        onReopen,
        onDiscard,
      }),
    ),
  );
  const text = host.textContent ?? "";
  expect(text).toContain(
    "Waiting for your sign-in to finish in the other window…",
  );
  expect(text).toMatch(/10:00 left\./);
  expect(text).toContain("Close any sign-in window that is still open");
  const live = host.querySelector('[role="status"]');
  expect(live?.textContent).toBe(
    "Waiting for your sign-in to finish in the other window…",
  );
  expect(host.querySelector('[aria-live="polite"]')).toBeNull();
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual([
    "Cancel and discard",
    "Reopen window",
  ]);
  act(() => buttons[0].click());
  act(() => buttons[1].click());
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(onReopen).toHaveBeenCalledOnce();
});
