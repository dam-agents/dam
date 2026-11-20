import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When, Then } = createBdd(test);

Given(
  "{word} has a model provider connected",
  async ({ person }, persona: Persona) => {
    const owner = await person(persona);
    expect(
      (await owner.api.connections.list.query()).length,
      `${persona} has no connection`,
    ).toBeGreaterThan(0);
  },
);

Given(
  "{word} has not accepted the Terms of Use",
  async ({ person }, persona: Persona) => {
    const someone = await person(persona);
    expect(
      await someone.api.terms.latestAcceptance.query(),
      `${persona} has accepted the Terms of Use: only Kim never accepts them`,
    ).toBeNull();
  },
);

When("{word} signs in", async ({ driver, person }, persona: Persona) =>
  driver.session.signIn(await person(persona)),
);

When(
  "{word} reads the Terms of Use",
  async ({ driver, person }, persona: Persona) =>
    driver.session.readTerms(await person(persona)),
);

When(
  "{word} follows a Slack bind link while signed out",
  async ({ driver, person, world }, persona: Persona) =>
    driver.session.followSignedOut(
      await person(persona),
      `/slack/bind?flow=${world.unique("bind-link")}`,
    ),
);

When(
  "{word} signs the CLI in and {word} it in the browser",
  async ({ driver, person }, persona: Persona, answer: string) => {
    if (answer !== "allows" && answer !== "refuses")
      throw new Error(`"${answer}" is no answer: allows or refuses`);
    await driver.session.signInCli(await person(persona), answer);
  },
);

Then(
  "{word} is asked to accept the Terms of Use before anything else",
  async ({ driver, person }, persona: Persona) =>
    driver.session.expectAskedForTerms(await person(persona)),
);

Then(
  "{word} sees the current Terms of Use",
  async ({ driver, person }, persona: Persona) =>
    driver.session.expectTermsShown(await person(persona)),
);

Then(
  "{word} lands on that Slack bind link",
  async ({ driver, person, world }, persona: Persona) =>
    driver.session.expectAt(
      await person(persona),
      `/slack/bind?flow=${world.unique("bind-link")}`,
    ),
);

Then(
  "the CLI is signed in as {word}",
  async ({ driver, person }, persona: Persona) =>
    driver.session.expectCliSignedIn(await person(persona), true),
);

Then(
  "the CLI of {word} is not signed in",
  async ({ driver, person }, persona: Persona) =>
    driver.session.expectCliSignedIn(await person(persona), false),
);
