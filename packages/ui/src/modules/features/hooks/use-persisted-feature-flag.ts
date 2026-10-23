import { useEffect } from "react";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useFeatures } from "../api/queries.js";

export type PersistedFeature = "new-layout" | "unified-right-toolbar";

const KEYS: Record<PersistedFeature, string> = {
  "new-layout": "platform-new-layout",
  "unified-right-toolbar": "platform-unified-right-toolbar",
};

export function persistedFeature(
  feature: PersistedFeature,
  flag: boolean | undefined,
): boolean {
  return flag ?? readPersistedFlag(KEYS[feature], false);
}

// UNIT_BOUNDARY_DESCRIPTION: until the flags load, the last value this browser saw decides, so an opted-in user does not see the old layout flash first. The server's value wins as soon as it arrives, and both experiments read their flag this way.
export function usePersistedFeature(feature: PersistedFeature): boolean {
  const flag = useFeatures().data?.[feature];
  useEffect(() => {
    if (flag !== undefined) writePersistedFlag(KEYS[feature], flag);
  }, [flag, feature]);
  return persistedFeature(feature, flag);
}
