import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";

import { baseUrl } from "./config.js";
import type { Person } from "./people.js";

/** UNIT_BOUNDARY_DESCRIPTION: one tab of an agent's browser, as the browser reports it to the panel. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: what the agent's browser reports to whoever watches it: whether it is up, its tabs and the tab in front. */
export interface BrowserSnapshot {
  state: "starting" | "ready" | "failed";
  message?: string;
  tabs: BrowserTab[];
  activeTab?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: what a call of the agent's browser control came to: its data, or the tRPC code and message it was refused with. */
export interface ControlOutcome {
  data?: unknown;
  code?: string;
  message?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: one call of an agent's browser control through the agent's tRPC relay over HTTP, as the web UI's panel calls it. */
export async function browserControl(
  person: Person,
  agentId: string,
  procedure: "selectTab" | "closeTab" | "newTab" | "navigate" | "clearData",
  input?: object,
): Promise<ControlOutcome> {
  const res = await fetch(
    `${baseUrl}/api/agents/${encodeURIComponent(agentId)}/trpc/browser.${procedure}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await person.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input ?? {}),
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    result?: { data?: unknown };
    error?: { message?: string; data?: { code?: string } };
  };
  if (body.error !== undefined)
    return { code: body.error.data?.code, message: body.error.message };
  return { data: body.result?.data };
}

/** UNIT_BOUNDARY_DESCRIPTION: a watch of an agent's browser, as the panel holds one while it is open: the latest snapshot, or the refusal that ended it. */
export interface BrowserWatch {
  latest(): BrowserSnapshot | undefined;
  refusal(): string | undefined;
  close(): void;
}

/** UNIT_BOUNDARY_DESCRIPTION: opens a watch of an agent's browser over the agent's tRPC WebSocket. Watching is what makes the runtime keep the tab list current, so a watch is held from the step that opens the browser to the end of the example. */
export async function watchBrowser(
  person: Person,
  agentId: string,
): Promise<BrowserWatch> {
  const token = await person.token();
  const ws = createWSClient({
    url: `${baseUrl.replace(/^http/, "ws")}/api/agents/${encodeURIComponent(agentId)}/trpc-ws?token=${encodeURIComponent(token)}`,
    retryDelayMs: () => 3_600_000,
  });
  const client = createTRPCClient<AnyTRPCRouter>({
    links: [wsLink({ client: ws })],
  }) as unknown as {
    browser: {
      watch: {
        subscribe(
          input: undefined,
          handlers: {
            onData(snapshot: BrowserSnapshot): void;
            onError(error: { data?: { code?: string }; message: string }): void;
          },
        ): { unsubscribe(): void };
      };
    };
  };
  let latest: BrowserSnapshot | undefined;
  let refusal: string | undefined;
  const sub = client.browser.watch.subscribe(undefined, {
    onData: (snapshot) => {
      latest = snapshot;
    },
    onError: (error) => {
      refusal = `${error.data?.code ?? ""} ${error.message}`;
    },
  });
  return {
    latest: () => latest,
    refusal: () => refusal,
    close: () => {
      sub.unsubscribe();
      ws.close();
    },
  };
}
