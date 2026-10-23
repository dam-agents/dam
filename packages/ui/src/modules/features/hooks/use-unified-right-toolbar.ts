import { usePersistedFeature } from "./use-persisted-feature-flag.js";

export function useUnifiedRightToolbar(): boolean {
  return usePersistedFeature("unified-right-toolbar");
}
