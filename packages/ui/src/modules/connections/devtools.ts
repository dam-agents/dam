import {
  isShowInternalConnectionsEnabled,
  setShowInternalConnections,
} from "./internal-only.js";

// Run `platformConnections.showInternal()` in the browser console to reveal internal-only connections
declare global {
  interface Window {
    platformConnections?: {
      showInternal: (on?: boolean) => void;
      status: () => boolean;
    };
  }
}

window.platformConnections = {
  showInternal: (on = true) => {
    setShowInternalConnections(on);
    window.location.reload();
  },
  status: isShowInternalConnectionsEnabled,
};
