import { useEffect } from "react";

import { useStore } from "../../../store.js";
import {
  parseRoute,
  type Route,
  routeToNavigationState,
  type View,
} from "../lib/routes.js";

const isChatView = (view: View) =>
  view === "chat" || view === "knowledge-base-chat";

const isChatRoute = (
  route: Route,
): route is Extract<Route, { view: "chat" | "knowledge-base-chat" }> =>
  isChatView(route.view);

export function useBrowserHistory(): void {
  useEffect(() => {
    const applyRoute = () => {
      const route = parseRoute(window.location.pathname);
      const wasChat = isChatView(useStore.getState().view);

      if (isChatRoute(route)) {
        useStore.getState().resetChatContext();
        useStore.setState({
          ...routeToNavigationState(route),
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
        ...(wasChat ? { selectedAgent: null } : {}),
      });
    };

    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);
}
