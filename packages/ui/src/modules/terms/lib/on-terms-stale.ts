import { useStore } from "../../../store.js";

export function onTermsStale() {
  if (useStore.getState().view === "terms") return;
  useStore.getState().setView("terms");
}
