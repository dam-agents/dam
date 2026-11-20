import { signInThroughTheBrowser } from "../../auth.js";
import type { SessionDriver } from "../driver.js";
import type { Pages } from "./pages.js";

export function uiSession(pages: Pages): SessionDriver {
  return {
    async signIn(person) {
      await signInThroughTheBrowser(await pages.fresh(person), person.account);
    },
  };
}
