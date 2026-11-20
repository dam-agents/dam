import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { Given, When } = createBdd(test);

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

When("{word} signs in", async ({ driver, person }, persona: Persona) =>
  driver.session.signIn(await person(persona)),
);
