import { createBdd } from "playwright-bdd";

import { test } from "../fixtures.js";
import type { Persona } from "../people.js";

const { When, Then } = createBdd(test);

When(
  "{word} sends {string} to {string}",
  async ({ driver, person }, persona: Persona, text: string, name: string) =>
    driver.chat.send(await person(persona), name, text),
);

Then(
  "{word} sees {string} answer {string}",
  async (
    { driver, person, world },
    persona: Persona,
    name: string,
    answer: string,
  ) =>
    driver.chat.expectAnswer(await person(persona), name, world.unique(answer)),
);

Then(
  "{word} sees {string} answer",
  async ({ driver, person }, persona: Persona, name: string) =>
    driver.chat.expectAnswer(await person(persona), name, undefined),
);
