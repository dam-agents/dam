// @vitest-environment happy-dom
// TEST_OVERVIEW: The sign-in page rotates through meanings of the product name above the heading. The page puts each word of a meaning on its own line, so a short meaning fills as many lines as a long one and the content below the heading does not move at a swap. A meaning counts its words by its spaces, so a meaning of four words fills four lines.
import { createGetKcContextMock } from "keycloakify/login/KcContext";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { I18n } from "../login/i18n.js";
import type { KcContext, KcContextExtension } from "../login/KcContext.js";
import Login from "../login/pages/Login.js";

const i18n = {
  msg: (key: string) => key,
  msgStr: (key: string) => key,
  advancedMsg: (key: string) => key,
  advancedMsgStr: (key: string) => key,
} as unknown as I18n;

function Template({ children }: TemplateProps<KcContext, I18n>) {
  return <>{children}</>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderLogin(nameMeanings: string) {
  const { getKcContextMock } = createGetKcContextMock({
    kcContextExtension: {
      themeName: "platform",
      properties: {
        PLATFORM_ALLOW_PASSWORD: "true",
        PLATFORM_SHARE_CLIENT_ID: "platform-share",
        PLATFORM_BRAND_NAME_MEANINGS: nameMeanings,
        PLATFORM_DOCS_URL: "",
        PLATFORM_LOGIN_COMMUNITY_LABEL: "",
        PLATFORM_LOGIN_COMMUNITY_URL: "",
        PLATFORM_API_URL: "",
      },
    } satisfies KcContextExtension,
    kcContextExtensionPerPage: {},
  });
  act(() =>
    root.render(
      <Login
        kcContext={getKcContextMock({ pageId: "login.ftl" })}
        i18n={i18n}
        doUseDefaultCss={false}
        Template={Template}
      />,
    ),
  );
  await vi.waitFor(() => {
    if (!container.querySelector("#kc-form-login"))
      throw new Error("not ready");
  });
}

const headingLines = () => {
  const heading = container.querySelector("h1");
  return [...(heading?.children ?? [])].map((line) => line.textContent?.trim());
};

// TEST_SCENARIO: a meaning of three words whose natural wrap put it on two lines at a desktop width.
it("puts each word of a meaning on its own line", async () => {
  await renderLogin('["Did Anyone Merge?"]');
  expect(headingLines()).toEqual(["Did", "Anyone", "Merge?"]);
  expect(container.querySelector("h1")?.textContent?.trim()).toBe(
    "Did Anyone Merge?",
  );
});
