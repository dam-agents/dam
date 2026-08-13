const FEATURES_MENU_STORAGE_KEY = "platform-debug:features-menu";

export function isFeaturesMenuRevealed(): boolean {
  try {
    return localStorage.getItem(FEATURES_MENU_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setFeaturesMenuRevealed(revealed: boolean): void {
  if (revealed) {
    localStorage.setItem(FEATURES_MENU_STORAGE_KEY, "true");
  } else {
    localStorage.removeItem(FEATURES_MENU_STORAGE_KEY);
  }
}
