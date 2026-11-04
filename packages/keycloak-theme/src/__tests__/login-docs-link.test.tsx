// @vitest-environment happy-dom
// TEST_OVERVIEW: The sign-in page's "Read the docs" link points at the install's documentation site, which Keycloak hands the theme as PLATFORM_DOCS_URL from the chart's links.docs value. An install that sets no documentation site, or a value that is not an http(s) URL, shows the sign-in text without the link.
import { createGetKcContextMock } from "keycloakify/login/KcContext";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

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

function renderLogin(docsUrl: string) {
  const { getKcContextMock } = createGetKcContextMock({
    kcContextExtension: {
      themeName: "platform",
      properties: {
        PLATFORM_ALLOW_PASSWORD: "true",
        PLATFORM_SHARE_CLIENT_ID: "platform-share",
        PLATFORM_BRAND_NAME_MEANINGS: "[]",
        PLATFORM_DOCS_URL: docsUrl,
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
}

const docsLink = () =>
  [...container.querySelectorAll("a")].find(
    (a) => a.textContent === "Read the docs to learn more.",
  );

// TEST_SCENARIO: an install that names its documentation site gets the link to it, opening in a new tab.
it("links the install's documentation site", () => {
  renderLogin("https://docs.example.com/platform/");
  expect(docsLink()?.getAttribute("href")).toBe(
    "https://docs.example.com/platform/",
  );
  expect(docsLink()?.getAttribute("target")).toBe("_blank");
});

// TEST_SCENARIO: an install that sets links.docs empty has no documentation site, so the page shows no dead link and the sign-in text still ends cleanly.
it("shows no link when the install sets no documentation site", () => {
  renderLogin("");
  expect(docsLink()).toBeUndefined();
  expect(container.textContent).toContain("built to repeat.");
});

// TEST_SCENARIO: a value that is not an http(s) URL, such as a javascript: URL, is never rendered as a link.
it("shows no link for a value that is not an http(s) URL", () => {
  renderLogin("javascript:alert(1)");
  expect(docsLink()).toBeUndefined();
});
