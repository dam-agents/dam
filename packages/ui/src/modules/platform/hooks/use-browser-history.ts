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
  useEffect(() => {
    let shownPath = window.location.pathname;
    const unsubscribe = useStore.subscribe(() => {
      shownPath = window.location.pathname;
    });

    const applyRoute = () => {
      if (RETIRED_PATHS.has(window.location.pathname)) {
        if (window.location.pathname === "/artifacts") {
          useStore.getState().setSidePanelTab("artifacts");
          useStore.getState().setMobileScreen("files");
        }
        window.history.replaceState({}, "", "/");
      }
      const route = parseRoute(window.location.pathname);
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
      if (!resetsDock || (!state.openArtifactDirty && !state.openFileDirty))
        return applyRoute();
      const leftPath = shownPath;
      void state.confirmDockDiscard().then((discard) => {
        if (discard) applyRoute();
        else window.history.pushState(null, "", leftPath);
      });
    };

    applyRoute();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      unsubscribe();
    };
  }, []);
}
