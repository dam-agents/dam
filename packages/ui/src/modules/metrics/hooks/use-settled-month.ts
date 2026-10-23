import { useRef } from "react";

export function useSettledMonth(month: Date, hasOwnData: boolean): Date {
  const settled = useRef(month);
  if (hasOwnData) settled.current = month;
  return settled.current;
}
