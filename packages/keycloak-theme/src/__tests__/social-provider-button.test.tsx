// @vitest-environment happy-dom
// TEST_OVERVIEW: The sign-in page shows one button per identity provider of the realm, labelled with the provider's display name. The IBM sign-in providers, w3id and IBMid, also show the IBM logo, so both can be offered side by side while sign-in moves from w3id to IBMid. Every other provider shows only its label.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { SocialProviderButton } from "../login/components/social-provider-button.js";

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

function renderButton(alias: string, displayName: string) {
  act(() =>
    root.render(
      <SocialProviderButton
        provider={{ alias, displayName, loginUrl: `/broker/${alias}/login` }}
      />,
    ),
  );
  return container.querySelector(`#social-${alias}`)!;
}

// TEST_SCENARIO: Keycloak keeps the alias as the admin typed it, so an IBMid provider can be `ibmid` or `IBMid`. Each IBM provider's button carries the IBM logo next to its label.
it.each([
  ["w3id", "Continue with w3id"],
  ["ibmid", "Continue with IBMid"],
  ["IBMid", "Continue with IBMid"],
])("the %s button shows the IBM logo", (alias, displayName) => {
  const button = renderButton(alias, displayName);
  expect(button.querySelector("img")?.getAttribute("src")).toMatch(
    /ibm-logo\.svg$/,
  );
  expect(button.textContent).toBe(displayName);
});

// TEST_SCENARIO: A provider that is not an IBM one shows only its label, with no IBM logo.
it("another provider's button shows no logo", () => {
  const button = renderButton("github", "Continue with GitHub");
  expect(button.querySelector("img")).toBeNull();
  expect(button.textContent).toBe("Continue with GitHub");
});
