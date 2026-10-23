import {
  persistedFeature,
  usePersistedFeature,
} from "./use-persisted-feature-flag.js";

export function newLayoutEnabled(flag: boolean | undefined): boolean {
  return persistedFeature("new-layout", flag);
}

export function useNewLayout(): boolean {
  return usePersistedFeature("new-layout");
}
