import { useStore } from "../../../store.js";

export const useShowPlanUse = () => useStore((s) => s.showPlanUse);

export const useSetShowPlanUse = () => useStore((s) => s.setShowPlanUse);

export const useMeteringNoticeDismissed = () =>
  useStore((s) => s.meteringNoticeDismissed);

export const useDismissMeteringNotice = () =>
  useStore((s) => s.dismissMeteringNotice);
