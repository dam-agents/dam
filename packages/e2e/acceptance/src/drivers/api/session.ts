import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { SessionDriver } from "../driver.js";

export function apiSession(world: World): SessionDriver {
  return {
    async signIn(person: Person) {
      await person.token();
      world.note({ step: "signed in", persona: person.persona });
    },
  };
}
