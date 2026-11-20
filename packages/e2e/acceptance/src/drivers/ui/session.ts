import { expect } from "@playwright/test";

import { signInThroughTheBrowser, submitSignInForm } from "../../auth.js";
import { baseUrl } from "../../config.js";
import type { SessionDriver } from "../driver.js";
import type { Pages } from "./pages.js";

const termsButton = { name: /I accept the Terms of Use/ };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session capability in the web UI: a person signs in through Keycloak's page, meets the Terms page until they accept the Terms, and follows links in a browser. The CLI's sign-in is no part of the web UI.
 */
export function uiSession(pages: Pages): SessionDriver {
  return {
    async signIn(person) {
      await signInThroughTheBrowser(
        await pages.fresh(person),
        person.account,
        person.acceptedTerms,
      );
    },
    async expectAskedForTerms(person) {
      const page = await pages.of(person);
      await page.goto(baseUrl);
      await expect(page).toHaveURL(/\/terms(\?|$)/);
      await expect(page.getByRole("button", termsButton)).toBeVisible();
      await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    },
    async readTerms(person) {
      const page = await pages.of(person);
      await page.goto(`${baseUrl}/terms`);
    },
    async expectTermsShown(person) {
      const page = await pages.of(person);
      const { version } = await person.api.terms.current.query();
      await expect(
        page.getByRole("heading", { name: "Terms of Use", level: 1 }),
      ).toBeVisible();
      await expect(page.getByText(`Version ${version}`)).toBeVisible();
    },
    async followSignedOut(person, path) {
      const page = await pages.fresh(person);
      await page.goto(`${baseUrl}${path}`);
      await expect(page.locator("#kc-form-login")).toBeVisible();
      await submitSignInForm(page, person.account);
    },
    async expectAt(person, path) {
      const page = await pages.of(person);
      const wanted = new URL(path, baseUrl);
      await expect
        .poll(() => {
          const at = new URL(page.url());
          return `${at.origin}${at.pathname}${at.search}`;
        })
        .toBe(`${wanted.origin}${wanted.pathname}${wanted.search}`);
      await expect(page.getByRole("heading").first()).toBeVisible();
    },
    async signInCli() {
      throw new Error(
        "the web UI signs no CLI in: an example of the CLI's sign-in is not tagged @ui",
      );
    },
    async expectCliSignedIn() {
      throw new Error(
        "the web UI signs no CLI in: an example of the CLI's sign-in is not tagged @ui",
      );
    },
  };
}
