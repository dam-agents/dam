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

// TEST_OVERVIEW: the browser panel controls the agent's browser through the runtime's `browser` tRPC procedures. Their errors are what the panel tells apart: an agent that does not offer the panel or cannot show it is refused with a code the panel does not retry, a non-web address is the caller's mistake, and watching streams the browser's state.

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
        setTestingMode: async () => err(error),
        watch: () => err(error),
      });
    for (const [error, code] of [
      [{ kind: "NotOffered" }, "FORBIDDEN"],
      [{ kind: "NoDisplay" }, "PRECONDITION_FAILED"],
      [{ kind: "NotWebAddress" }, "BAD_REQUEST"],
    ] as const) {
      const call = refusing(error);
      await expect(call.browser.navigate({ url: "x" })).rejects.toMatchObject({
        code,
      });
      await expect(call.browser.reload()).rejects.toMatchObject({ code });
      await expect(
        call.browser.setTestingMode({ on: false }),
      ).rejects.toMatchObject({ code });
      await expect(
        (async () => {
          for await (const _ of await call.browser.watch()) break;
        })(),
      ).rejects.toMatchObject({ code });
    }
  });

  // TEST_SCENARIO: watching yields the browser's state as the service reports it, and each toolbar action and the testing mode switch reach the service as themselves.
  it("streams state and runs each toolbar action", async () => {
    const acted: BrowserAction[] = [];
    const modes: boolean[] = [];
    const call = caller({
      watch: () =>
        ok(
          (async function* () {
            yield snapshot;
          })(),
        ),
      act: async (action) => {
        acted.push(action);
        return ok(undefined);
      },
      navigate: async () => ok(undefined),
      setTestingMode: async (on) => {
        modes.push(on);
        return ok(undefined);
      },
    });
    const seen: BrowserSnapshot[] = [];
    for await (const s of await call.browser.watch()) seen.push(s);
    expect(seen).toEqual([snapshot]);

    await call.browser.reload();
    await call.browser.stop();
    await call.browser.back();
    await call.browser.forward();
    await call.browser.restart();
    await call.browser.clearData();
    await call.browser.setTestingMode({ on: false });
    expect(acted).toEqual([
      "reload",
      "stop",
      "back",
      "forward",
      "restart",
      "clearData",
    ]);
    expect(modes).toEqual([false]);
    await expect(call.browser.navigate({ url: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
