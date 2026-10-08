import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { fetchUsageReportPage } from "./inspect.js";

export function useRecordEntryPoint() {
  return useMutation({
    ...trpc.usage.entryPointChosen.mutationOptions(),
    meta: { suppressErrorToast: true },
  });
}

export function useOpenUsageReport() {
  return useMutation({
    mutationFn: async (target: Window | null) => {
      const url = await fetchUsageReportPage();
      if (target) target.location.replace(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (_err, target) => target?.close(),
    meta: { errorToast: "Couldn't open the usage report" },
  });
}
