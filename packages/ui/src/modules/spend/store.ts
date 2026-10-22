import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";
import type { PlatformStore } from "../../store.js";

const SHOW_PLAN_USE_KEY = "platform-spend-show-plan-use";
const METERING_NOTICE_DISMISSED_KEY =
  "platform-spend-metering-notice-dismissed";

export interface SpendSlice {
  showPlanUse: boolean;
  meteringNoticeDismissed: boolean;
  setShowPlanUse: (show: boolean) => void;
  dismissMeteringNotice: () => void;
}

export const createSpendSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SpendSlice
> = (set) => ({
  showPlanUse: readPersistedFlag(SHOW_PLAN_USE_KEY, false),
  meteringNoticeDismissed: readPersistedFlag(
    METERING_NOTICE_DISMISSED_KEY,
    false,
  ),
  setShowPlanUse: (show) => {
    writePersistedFlag(SHOW_PLAN_USE_KEY, show);
    set({ showPlanUse: show });
  },
  dismissMeteringNotice: () => {
    writePersistedFlag(METERING_NOTICE_DISMISSED_KEY, true);
    set({ meteringNoticeDismissed: true });
  },
});
