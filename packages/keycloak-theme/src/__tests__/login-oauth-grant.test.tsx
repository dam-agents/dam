// @vitest-environment happy-dom
// TEST_OVERVIEW: On the grant screen Keycloak reads the user's answer from the name of the clicked submit button: it denies the grant only when `cancel` is in the POST, and grants it otherwise. A disabled button is left out of the form data, so the page must not disable the clicked button before the browser builds that data (#5701). The click runs outside act(), as in a browser. React applies the submit handler's state update in a microtask, which a browser runs as soon as the handler returns, before it builds the POST. The test builds the posted fields by the same rule, after that microtask: the form's own fields, and the submitter's name when it is not disabled. Each answer must reach the POST, and a second click must not submit the form again.
import { createGetKcContextMock } from "keycloakify/login/KcContext";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { I18n } from "../login/i18n.js";
import type { KcContext, KcContextExtension } from "../login/KcContext.js";
import LoginOauthGrant from "../login/pages/LoginOauthGrant.js";

const { getKcContextMock } = createGetKcContextMock({
  kcContextExtension: {
    themeName: "platform",
    properties: {
      PLATFORM_ALLOW_PASSWORD: "true",
      PLATFORM_SHARE_CLIENT_ID: "platform-share",
    },
  } satisfies KcContextExtension,
  kcContextExtensionPerPage: {},
});

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
let submitted: string[][];

function recordPost(event: Event) {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const { submitter } = event as SubmitEvent;
  const fields = [...new FormData(event.target as HTMLFormElement).keys()];
  queueMicrotask(() => {
    if (submitter instanceof HTMLButtonElement && !submitter.disabled) {
      fields.push(submitter.name);
    }
    submitted.push(fields.sort());
  });
}

beforeEach(() => {
  submitted = [];
  document.addEventListener("submit", recordPost);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <LoginOauthGrant
        kcContext={getKcContextMock({
          pageId: "login-oauth-grant.ftl",
          overrides: { oauth: { code: "grant-code" } },
        })}
        i18n={i18n}
        doUseDefaultCss={false}
        Template={Template}
      />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.removeEventListener("submit", recordPost);
});

async function click(id: string) {
  container.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// TEST_SCENARIO: The bug: "No" posted only `code`, so Keycloak granted. The POST for "No" must carry `cancel`, and not `accept`.
it("No submits cancel", async () => {
  await click("kc-cancel");
  expect(submitted).toEqual([["cancel", "code"]]);
});

// TEST_SCENARIO: "Yes" must still grant: its POST carries `accept`, and not `cancel`.
it("Yes submits accept", async () => {
  await click("kc-login");
  expect(submitted).toEqual([["accept", "code"]]);
});

// TEST_SCENARIO: After the first click the page waits for Keycloak's answer. The buttons show they are busy, and a second click, on either button, sends no second POST.
it("a second click does not submit again", async () => {
  await click("kc-cancel");
  await click("kc-login");
  await click("kc-cancel");
  expect(submitted).toEqual([["cancel", "code"]]);
  expect(
    container.querySelector("#kc-login")!.getAttribute("aria-disabled"),
  ).toBe("true");
});
