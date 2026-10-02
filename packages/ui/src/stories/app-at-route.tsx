import { useState } from "react";

import App from "@/app";
import { queryClient } from "@/query-client";
import { useStore } from "@/store";

import { type Scenario, setScenario } from "./backend/scenario";

interface Props {
  path: string;
  scenario?: Scenario;
  /** Query params some views read once at module load (`null` = absent). */
  query?: Record<string, string | null>;
  /** localStorage entries to set before the app renders. */
  storage?: Record<string, string>;
}

let storedKeys: string[] = [];

function queryMismatch(query: Props["query"]): URLSearchParams | null {
  if (!query) return null;
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  for (const [key, value] of Object.entries(query)) {
    if (params.get(key) === value) continue;
    changed = true;
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return changed ? params : null;
}

/** Mounts the real `<App />` at `path`. The app routes off
 *  `window.location.pathname`, so the iframe URL is rewritten before first
 *  render; Storybook's own query params are kept so the preview still resolves. */
export function AppAtRoute({
  path,
  scenario = "populated",
  query,
  storage,
}: Props) {
  const [reloading] = useState(() => {
    const fix = queryMismatch(query);
    if (fix) {
      // Modules already read the old query, so only a fresh load picks it up.
      window.location.replace(`/iframe.html?${fix.toString()}`);
      return true;
    }
    for (const key of storedKeys) localStorage.removeItem(key);
    storedKeys = Object.keys(storage ?? {});
    for (const [key, value] of Object.entries(storage ?? {}))
      localStorage.setItem(key, value);
    setScenario(scenario);
    queryClient.clear();
    window.history.replaceState({}, "", `${path}${window.location.search}`);
    useStore.getState().hydrateRoute();
    return false;
  });
  return reloading ? null : <App />;
}
