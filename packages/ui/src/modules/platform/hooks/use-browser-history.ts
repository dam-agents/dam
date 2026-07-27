import { useEffect } from "react";

import { useStore } from "../../../store.js";
import {
  parseRoute,
  routeToNavigationState,
  type View,
} from "../lib/routes.js";

/** A knowledge base's page is the same ChatView under its own route, so both
 *  views carry their agent in `selectedAgent` and share chat's teardown. */
const isChatView = (view: View) =>
  view === "chat" || view === "knowledge-base-chat";

/**
 * The UI's only popstate listener. Entering either chat surface always resets
 * chat context and sets `selectedAgent`; leaving one for any other view resets
 * and clears it; non-chat → non-chat transitions touch no chat state.
 */
export function useBrowserHistory(): void {
  useEffect(() => {
    const applyRoute = () => {
      const route = parseRoute(window.location.pathname);
      const wasChat = isChatView(useStore.getState().view);

      if (route.view === "chat" || route.view === "knowledge-base-chat") {
        useStore.getState().resetChatContext();
        useStore.setState({
          ...routeToNavigationState(route),
          selectedAgent: route.agent,
        });
        return;
      }

      if (wasChat) useStore.getState().resetChatContext();
      useStore.setState({
        ...routeToNavigationState(route),
        ...(wasChat ? { selectedAgent: null } : {}),
      });
    };

    // Not redundant next to navigation.ts's initializer: this mount-time call
    // is the only thing that sets `selectedAgent` on a cold load at
    // /chat/:agent (the agents slice initializes it to null), and it re-parses
    // the URL after auth.ts restores the post-login return path.
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);
}
