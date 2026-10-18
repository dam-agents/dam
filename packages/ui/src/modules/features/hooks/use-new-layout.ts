import { useEffect } from "react";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useFeatures } from "../api/queries.js";

const KEY = "platform-new-layout";

// UNIT_BOUNDARY_DESCRIPTION: until the flags load, the last value this browser saw decides, so an opted-in user does not see the current layout flash first.
export function useNewLayout(): boolean {
  const flag = useFeatures().data?.["new-layout"];
  useEffect(() => {
    if (flag !== undefined) writePersistedFlag(KEY, flag);
  }, [flag]);
  return flag ?? readPersistedFlag(KEY, false);
}
