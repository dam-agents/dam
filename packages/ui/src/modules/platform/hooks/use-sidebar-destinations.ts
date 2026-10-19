import {
  Book,
  Box,
  type CarbonIconType,
  Home,
  Settings,
} from "@carbon/icons-react";

import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { ArtifactIcon } from "../../artifacts/lib/artifact-icon.js";

export interface SidebarDestination {
  label: string;
  icon: CarbonIconType;
  active: boolean;
  navigate: () => void;
}

export function useSidebarDestinations() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const kitBrowserOpen = useStore((s) => s.kitBrowserOpen);
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const setArtifactsSectionOpen = useStore((s) => s.setArtifactsSectionOpen);
  const artifactsOpen = useStore((s) => s.sidePanelTab === "artifacts");

  const home: SidebarDestination = {
    label: "Home",
    icon: Home,
    active: view === "home" && !artifactsOpen,
    navigate: () => setView("home"),
  };
  const artifacts: SidebarDestination = {
    label: "Artifacts",
    icon: ArtifactIcon,
    active: artifactsOpen,
    navigate: () => {
      setSidePanelTab("artifacts");
      setArtifactsSectionOpen(true);
      setMobileScreen("files");
    },
  };
  const starterKits: SidebarDestination = {
    label: "Starter kits",
    icon: Box,
    active: view === "starter-kit" || kitBrowserOpen,
    navigate: () => setKitBrowserOpen(true),
  };
  const docs: SidebarDestination = {
    label: "Documentation",
    icon: Book,
    active: false,
    navigate: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer"),
  };
  const settings: SidebarDestination = {
    label: "Settings",
    icon: Settings,
    active: view === "settings",
    navigate: () => navigateToSettings(),
  };

  return {
    home,
    primary: [home, artifacts, starterKits],
    secondary: [docs, settings],
  };
}
