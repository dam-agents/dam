export const SHOW_EXPERIMENTS_STORAGE_KEY = "platform-debug:show-experiments";

export function isShowExperimentsEnabled(): boolean {
  try {
    return localStorage.getItem(SHOW_EXPERIMENTS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setShowExperiments(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(SHOW_EXPERIMENTS_STORAGE_KEY, "true");
  } else {
    localStorage.removeItem(SHOW_EXPERIMENTS_STORAGE_KEY);
  }
}
