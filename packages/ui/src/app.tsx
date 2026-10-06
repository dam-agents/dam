import { useEffect } from "react";

import { DialogOverlay } from "./components/dialog-overlay.js";
import { useAgentCrashToasts } from "./modules/agents/hooks/use-agent-crash-toasts.js";
import { AvatarSheetView } from "./modules/avatar-sheet/avatar-sheet-view.js";
import { GettingStartedDock } from "./modules/avatar-sheet/getting-started-checklist.js";
import { GettingStartedSheetView } from "./modules/avatar-sheet/getting-started-sheet-view.js";
import { useLiveEvents } from "./modules/live-events/use-live-events.js";
import { useBrowserHistory } from "./modules/platform/hooks/use-browser-history.js";
import { useStore } from "./store.js";

export default function App() {
  const theme = useStore((s) => s.theme);

  useBrowserHistory();

  useEffect(() => {
    const apply = () => {
      const t = useStore.getState().theme;
      const isDark =
        t === "dark" ||
        (t === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return <MainApp />;
}

function MainApp() {
  const view = useStore((s) => s.view);

  useLiveEvents();
  useAgentCrashToasts();

  return (
    <>
      <div className="h-full overflow-y-auto bg-background">
        {view === "getting-started-sheet" ? (
          <GettingStartedSheetView />
        ) : (
          <AvatarSheetView />
        )}
      </div>
      <GettingStartedDock />
      <DialogOverlay />
    </>
  );
}
