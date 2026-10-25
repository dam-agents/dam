import { describe, it, expect } from "vitest";
import {
  err,
  ok,
  type AgentRuntimeContext,
  type BrowserAction,
  type BrowserDomainError,
  type BrowserService,
  type BrowserSnapshot,
} from "agent-runtime-api";
import { appRouter } from "agent-runtime-api/router";

// TEST_OVERVIEW: the browser panel controls the agent's browser through the runtime's `browser` tRPC procedures. Their errors are what the panel tells apart: an agent that does not offer the panel or cannot show it is refused with a code the panel does not retry, a non-web address is the caller's mistake, a closed tab is not found, and watching streams the browser's state.

const snapshot: BrowserSnapshot = {
  state: "ready",
  message: null,
  page: {
    url: "http://a/",
    title: "A",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  },
};

function caller(service: Partial<BrowserService>) {
  return appRouter.createCaller({
    browser: service as BrowserService,
  } as AgentRuntimeContext);
}

describe("browser procedures", () => {
  // TEST_SCENARIO: an agent without named connections, an image without the display stack, and an address that is not http or https are each answered with their own code: FORBIDDEN and PRECONDITION_FAILED, which the panel shows as "not offered here" without retrying, and BAD_REQUEST.
  it("maps each refusal to its own code", async () => {
    const refusing = (error: BrowserDomainError) =>
      caller({
        navigate: async () => err(error),
        act: async () => err(error),
        selectTab: async () => err(error),
        newTab: async () => err(error),
        closeTab: async () => err(error),
        watch: () => err(error),
      });
    for (const [error, code] of [
      [{ kind: "NotOffered" }, "FORBIDDEN"],
      [{ kind: "NoDisplay" }, "PRECONDITION_FAILED"],
      [{ kind: "NotWebAddress" }, "BAD_REQUEST"],
      [{ kind: "TabGone" }, "NOT_FOUND"],
    ] as const) {
      const call = refusing(error);
      await expect(call.browser.navigate({ url: "x" })).rejects.toMatchObject({
        code,
      });
      await expect(call.browser.reload()).rejects.toMatchObject({ code });
      await expect(call.browser.selectTab({ tab: "T1" })).rejects.toMatchObject(
        { code },
      );
      await expect(call.browser.newTab()).rejects.toMatchObject({ code });
      await expect(call.browser.closeTab({ tab: "T1" })).rejects.toMatchObject({
        code,
      });
      await expect(
        (async () => {
          for await (const _ of await call.browser.watch()) break;
        })(),
      ).rejects.toMatchObject({ code });
    }
  });

  // TEST_SCENARIO: watching yields the browser's state as the service reports it, and each toolbar action and tab bar action reaches the service as itself, with the tab it names; a panel from before tabs names none, and a new tab answers with its target id.
  it("streams state and runs each toolbar action", async () => {
    const acted: [BrowserAction, string | undefined][] = [];
    const tabbed: string[] = [];
    const navigated: [string, string | undefined][] = [];
    const call = caller({
      watch: () =>
        ok(
          (async function* () {
            yield snapshot;
          })(),
        ),
      act: async (action, tab) => {
        acted.push([action, tab]);
        return ok(undefined);
      },
      selectTab: async (tab) => {
        tabbed.push(`select ${tab}`);
        return ok(undefined);
      },
      newTab: async () => {
        tabbed.push("new");
        return ok("T3");
      },
      closeTab: async (tab) => {
        tabbed.push(`close ${tab}`);
        return ok(undefined);
      },
      navigate: async (url, tab) => {
        navigated.push([url, tab]);
        return ok(undefined);
      },
    });
    const seen: BrowserSnapshot[] = [];
    for await (const s of await call.browser.watch()) seen.push(s);
    expect(seen).toEqual([snapshot]);

    await call.browser.reload();
    await call.browser.stop({ tab: "T2" });
    await call.browser.back({ tab: "T2" });
    await call.browser.forward({});
    await call.browser.restart();
    await call.browser.clearData();
    expect(acted).toEqual([
      ["reload", undefined],
      ["stop", "T2"],
      ["back", "T2"],
      ["forward", undefined],
      ["restart", undefined],
      ["clearData", undefined],
    ]);
    await call.browser.navigate({ url: "http://a/" });
    await call.browser.navigate({ url: "http://b/", tab: "T2" });
    expect(navigated).toEqual([
      ["http://a/", undefined],
      ["http://b/", "T2"],
    ]);
    await call.browser.selectTab({ tab: "T2" });
    expect(await call.browser.newTab()).toEqual({ tab: "T3" });
    await call.browser.closeTab({ tab: "T2" });
    expect(tabbed).toEqual(["select T2", "new", "close T2"]);
    await expect(call.browser.selectTab({ tab: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(call.browser.navigate({ url: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
