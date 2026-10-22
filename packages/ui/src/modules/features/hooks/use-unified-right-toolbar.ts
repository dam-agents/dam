import { useEffect } from "react";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useFeatures } from "../api/queries.js";

const KEY = "platform-unified-right-toolbar";

export function unifiedRightToolbarEnabled(flag: boolean | undefined): boolean {
  return flag ?? readPersistedFlag(KEY, false);
}

// UNIT_BOUNDARY_DESCRIPTION: the right rail's own experiment, independent of JanUI: the saved preference decides until the flags load, so a user who opted in does not see the classic icon bar flash first.
export function useUnifiedRightToolbar(): boolean {
  const flag = useFeatures().data?.["unified-right-toolbar"];
  useEffect(() => {
    if (flag !== undefined) writePersistedFlag(KEY, flag);
  }, [flag]);
  return unifiedRightToolbarEnabled(flag);
}
