import { useEffect } from "react";

import { useStore } from "../../../store.js";
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
    if (RETIRED_PATHS.has(window.location.pathname)) {
      if (window.location.pathname === "/artifacts") {
        useStore.getState().setSidePanelTab("artifacts");
        useStore.getState().setMobileScreen("files");
      }
      window.history.replaceState({}, "", "/");
    }
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
    const state = useStore.getState();
    const resetsDock =
      isChatView(state.view) ||
      isChatRoute(parseRoute(window.location.pathname));
    if (confirming) return;
    if (!resetsDock || (!state.openArtifactDirty && !state.openFileDirty))
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
