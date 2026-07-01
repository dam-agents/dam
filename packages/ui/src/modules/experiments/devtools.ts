import {
  isShowExperimentsEnabled,
  setShowExperiments,
} from "./internal-only.js";

declare global {
  interface Window {
    platformExperiments?: {
      show: (on?: boolean) => void;
      status: () => boolean;
    };
  }
}

window.platformExperiments = {
  show: (on = true) => {
    setShowExperiments(on);
    window.location.reload();
  },
  status: isShowExperimentsEnabled,
};
