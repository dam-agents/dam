import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { takeBackPress } from "../lib/back-entry.js";
import {
  parseRoute,
  RETIRED_PATHS,
  type Route,
  routeToNavigationState,
  type View,
} from "../lib/routes.js";

const isChatView = (view: View) => view === "chat";

const isChatRoute = (route: Route): route is Extract<Route, { view: "chat" }> =>
  isChatView(route.view);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether a move from one route to another drops an
 * unsaved artifact or file draft. A chat and the artifact page each hold their
 * own editor, so a move into or out of either, or to another artifact's page,
 * drops it. Between other pages the side panel keeps its dock, and the draft
 * with it.
 */
const dropsEditor = (
  from: { view: View; pageArtifactId: string | null },
  to: Route,
) =>
  isChatView(from.view) ||
  isChatRoute(to) ||
  ((from.view === "artifact" || to.view === "artifact") &&
    (to.view !== "artifact" || to.artifactId !== from.pageArtifactId));

export function useBrowserHistory(): void {
  useEffect(installBrowserHistory, []);
}

export function installBrowserHistory(): () => void {
  const snapshot = () => ({
    url: `${location.pathname}${location.search}${location.hash}`,
    state: history.state as unknown,
  });
  let shown = snapshot();
  let confirming = false;
  const refresh = () => {
    if (!confirming) shown = snapshot();
  };
  const unsubscribe = useStore.subscribe(() => {
    refresh();
    setTimeout(refresh);
  });

  const applyRoute = () => {
    if (RETIRED_PATHS.has(window.location.pathname))
      window.history.replaceState({}, "", "/");
    const route = parseRoute(window.location.pathname, window.location.search);
    const wasChat = isChatView(useStore.getState().view);

    if (isChatRoute(route)) {
      useStore.getState().resetChatContext();
      useStore.setState({
        ...routeToNavigationState(route),
        kitBrowserOpen: false,
        selectedAgent: route.agent,
        ...("session" in route && route.session
          ? {
              pendingResumeSessionId: route.session,
              mobileScreen: "chat" as const,
            }
          : {}),
      });
      return;
    }

    if (wasChat) useStore.getState().resetChatContext();
    useStore.setState({
      ...routeToNavigationState(route),
      kitBrowserOpen: false,
      ...(wasChat ? { selectedAgent: null } : {}),
    });
  };

  const onPopState = () => {
    if (takeBackPress()) return;
    const state = useStore.getState();
    const dropsDraft = dropsEditor(
      state,
      parseRoute(window.location.pathname, window.location.search),
    );
    if (confirming) return;
    if (!dropsDraft || (!state.openArtifactDirty && !state.openFileDirty))
      return applyRoute();
    const left = shown;
    confirming = true;
    void state.confirmDockDiscard().then((discard) => {
      confirming = false;
      if (discard) applyRoute();
      else {
        window.history.pushState(left.state, "", left.url);
        shown = left;
      }
    });
  };

  applyRoute();
  window.addEventListener("popstate", onPopState);
  return () => {
    window.removeEventListener("popstate", onPopState);
    unsubscribe();
  };
}
