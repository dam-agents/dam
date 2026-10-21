// @vitest-environment happy-dom
// TEST_OVERVIEW: a CurveBender key starts with sk-. When the user types a key that does not, such as an IBM Cloud API key, the CurveBender form says that IBM Cloud keys don't work here and links the LiteLLM dashboard where the key is generated.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LiteLlmProxyForm } from "../../modules/providers/components/litellm-proxy/form.js";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(provider: "curve-bender" | "ibm-litellm") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(LiteLlmProxyForm, {
        provider,
        variant: "wizard",
        onSave: async () => {},
      }),
    ),
  );
}

async function type(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const hint = () =>
  [...container.querySelectorAll('[role="status"]')].find((el) =>
    el.textContent?.includes("IBM Cloud API keys don't work here"),
  );

// TEST_SCENARIO: a user pastes an IBM Cloud API key into the CurveBender form; the form tells them it is the wrong kind of key and where the right one comes from.
it("warns about a CurveBender key that does not start with sk-", async () => {
  mount("curve-bender");
  await type("Xy7_ibmcloud-api-key");
  expect(hint()).toBeDefined();
  expect(hint()?.querySelector("a")?.getAttribute("href")).toBe(
    "https://litellm.cb.ete.res.ibm.com/ui/",
  );
});

// TEST_SCENARIO: an empty field or a key of the right kind gets no warning, and the warning goes away once the user fixes the key.
it("says nothing for an empty field or an sk- key", async () => {
  mount("curve-bender");
  expect(hint()).toBeUndefined();
  await type("not-a-key");
  expect(hint()).toBeDefined();
  await type("  sk-abc123");
  expect(hint()).toBeUndefined();
});

// TEST_SCENARIO: the ETE LiteLLM Proxy form has its own key advice; the CurveBender warning is not shown there.
it("does not warn on the ETE LiteLLM Proxy form", async () => {
  mount("ibm-litellm");
  await type("not-a-key");
  expect(hint()).toBeUndefined();
});
