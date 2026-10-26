import {
  Book,
  type CarbonIconType,
  Gift,
  Home,
  Settings,
} from "@carbon/icons-react";

import { useStore } from "../../../store.js";
import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";
import { useUnifiedRightToolbar } from "../../features/hooks/use-unified-right-toolbar.js";
import { useDocsUrl } from "../../links/api/queries.js";

export interface SidebarDestination {
  label: string;
  icon: CarbonIconType;
  active: boolean;
  navigate: () => void;
}

export function useSidebarDestinations() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const rightToolbar = useUnifiedRightToolbar();
  const docsUrl = useDocsUrl("home");

  const home: SidebarDestination = {
    label: "Home",
    icon: Home,
    active: view === "home",
    navigate: () => setView("home"),
  };
  const artifacts: SidebarDestination = {
    label: "Artifacts",
    icon: ArtifactIcon,
    active: view === "artifacts",
    navigate: () => setView("artifacts"),
  };
  const starterKits: SidebarDestination = {
    label: "Starter kits",
    icon: Gift,
    active: view === "starter-kits" || view === "starter-kit",
    navigate: () => setView("starter-kits"),
  };
  const docs: SidebarDestination[] = docsUrl
    ? [
        {
          label: "Documentation",
          icon: Book,
          active: false,
          navigate: () => window.open(docsUrl, "_blank", "noopener,noreferrer"),
        },
      ]
    : [];
  const settings: SidebarDestination = {
    label: "Settings",
    icon: Settings,
    active: view === "settings",
    navigate: () => navigateToSettings(),
  };

  return {
    home,
    // UNIT_BOUNDARY_DESCRIPTION: the right toolbar offers Artifacts on every page, so the navigation leaves its own entry out while that flag is on rather than naming the same place twice; Documentation is the navigation's alone, since the rail shows no docs surface.
    primary: rightToolbar
      ? [home, starterKits]
      : [home, artifacts, starterKits],
    secondary: [...docs, settings],
  };
}
